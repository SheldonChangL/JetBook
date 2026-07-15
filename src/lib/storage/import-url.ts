import "server-only";
import http from "node:http";
import https from "node:https";
import dns from "node:dns/promises";
import net from "node:net";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { pages } from "@/lib/db/schema";
import { can, type Actor } from "@/lib/authz/permission";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/audit";
import { maxUploadBytes, saveAttachment } from "./upload";
import {
  AttachmentImportError,
  type AttachmentImportErrorCode,
  MAX_IMPORT_REDIRECTS,
  assertUrlAllowed,
  isForbiddenIp,
  resolveRedirectTarget,
} from "./ssrf";
import { isAllowedImageMime, normalizeImportFilename, sniffImage } from "./image-sniff";

/**
 * 伺服器端 URL 圖片匯入（issue #237）：MCP 工具 import_attachment_from_url 的 lib 層。
 *
 * 流程：驗頁面寫入權限 → SSRF 防護下載（協定/host/IP 逐跳驗證、redirect 上限、size cap、
 * timeout）→ magic bytes 內容驗證（不信副檔名/header）→ 重用既有 saveAttachment 管線存為
 * 永久附件並綁定 Page → 回傳內部 URL 與可直接使用的 Markdown。
 *
 * 半成品清理：下載或內容驗證失敗時尚未落地任何檔案；saveAttachment 於 DB 寫入失敗時自動
 * 回收已寫入的檔案（見 upload.ts）——故任一步失敗皆不留孤兒附件。
 *
 * 大型檔案不經模型：位元組全程在伺服器端串流處理，只回傳 metadata 與 URL（無 base64）。
 */

/** 單次連線／下載的 socket 閒置逾時（ms）。 */
const IMPORT_TIMEOUT_MS = 15_000;
/** 單一連線的絕對逾時上限（ms）：即使持續 trickle 也在此中止（防慢速耗盡）。 */
const IMPORT_ABSOLUTE_TIMEOUT_MS = 30_000;

// ── 可注入的網路依賴（預設走 node:http/https；測試以 fake 注入，免真實網路與 loopback 例外） ──

/** DNS 解析器：hostname → IP 字串陣列。預設 node dns.lookup(all)。 */
export type HostResolver = (hostname: string) => Promise<string[]>;

/** 低階 HTTP 回應：狀態、標頭、內容串流（downloadImage 負責 size cap 與 redirect 判斷）。 */
export interface ImportHttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  /** 回應內容串流（Node Readable 或任意 async iterable of Buffer）。 */
  body: AsyncIterable<Buffer>;
  /** 放棄此回應（redirect／非 2xx 時釋放連線）。 */
  discard?: () => void;
}

/** HTTP 傳輸層；預設將連線 pin 到已驗證 IP（TLS 仍以 hostname 驗證憑證）。 */
export type ImportTransport = (
  url: URL,
  ctx: { pinnedAddress: string; family: number; timeoutMs: number },
) => Promise<ImportHttpResponse>;

/** 將底層網路錯誤轉為 AttachmentImportError（不洩漏來源憑證）。 */
function wrapDownloadError(error: unknown): AttachmentImportError {
  if (error instanceof AttachmentImportError) return error;
  const name = (error as { name?: string } | undefined)?.name;
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "ABORT_ERR" ||
    name === "AbortError" ||
    name === "TimeoutError"
  ) {
    return new AttachmentImportError("TIMEOUT", "連線逾時或中斷");
  }
  return new AttachmentImportError("DOWNLOAD_FAILED", "下載失敗");
}

/**
 * 產生將連線 pin 到已驗證 IP 的 DNS lookup。**關鍵**：Node 的 http/https agent 以
 * `{ all: true }` 呼叫 lookup，此時回呼須回傳陣列 `[{ address, family }]`；否則（單值形）
 * 在 Node ≥18 會擲 `ERR_INVALID_IP_ADDRESS`，使所有以 hostname（非 IP 字面）為來源的匯入失敗。
 * 同時支援單值形（options.all 為 false／未帶）以策安全。連線 pin 到此位址（不再重新解析），
 * TLS servername 仍為原 hostname，故憑證驗證不受影響（DNS rebinding 縱深防禦）。
 */
export function pinnedLookup(address: string, family: number): net.LookupFunction {
  const fn = (
    _hostname: string,
    options: unknown,
    callback: (err: NodeJS.ErrnoException | null, address: unknown, family?: number) => void,
  ) => {
    const all = typeof options === "object" && options !== null && (options as { all?: boolean }).all;
    if (all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
  return fn as unknown as net.LookupFunction;
}

/** 預設 DNS 解析器：回傳全部 A/AAAA 位址（供逐一驗證，防 round-robin 繞過）。 */
const defaultResolver: HostResolver = async (hostname) => {
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  return records.map((r) => r.address);
};

/**
 * 預設 HTTP 傳輸：node:http/https GET，以自訂 lookup 將連線 pin 到已驗證 IP，
 * 避免 agent 重新解析到不同（可能被封鎖）位址（DNS rebinding 縱深防禦）。
 * TLS servername 仍為 url.hostname，憑證驗證不受 pin 影響。內容串流交由 downloadImage 讀取。
 * 匯出供測試以真實 node:http 路徑對本機伺服器驗證（含自訂 lookup 回呼形態）。
 */
export const nodeHttpTransport: ImportTransport = (url, ctx) =>
  new Promise<ImportHttpResponse>((resolve, reject) => {
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.request(
      url,
      {
        method: "GET",
        lookup: pinnedLookup(ctx.pinnedAddress, ctx.family),
        headers: { accept: "image/*", "user-agent": "JetBook-AttachmentImport/1" },
        timeout: ctx.timeoutMs,
        signal: AbortSignal.timeout(IMPORT_ABSOLUTE_TIMEOUT_MS),
      },
      (res) => {
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: res as AsyncIterable<Buffer>,
          discard: () => {
            res.destroy();
            req.destroy();
          },
        });
      },
    );
    req.on("timeout", () => req.destroy(new AttachmentImportError("TIMEOUT", "連線逾時")));
    req.on("error", (e) => reject(wrapDownloadError(e)));
    req.end();
  });

/** 串流讀取內容並強制 size cap；累積超過 maxBytes 立即中止（防記憶體耗盡）。 */
async function readCapped(body: AsyncIterable<Buffer>, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of body) {
      total += chunk.length;
      if (total > maxBytes) {
        throw new AttachmentImportError("FILE_TOO_LARGE", "下載內容超過大小上限");
      }
      chunks.push(chunk);
    }
  } catch (error) {
    throw wrapDownloadError(error);
  }
  return Buffer.concat(chunks);
}

/** downloadImage 選項。 */
export interface DownloadImageOptions {
  allowlist: readonly string[];
  maxBytes: number;
  timeoutMs: number;
  maxRedirects?: number;
  resolver?: HostResolver;
  transport?: ImportTransport;
}

/** 下載結果（位元組 + 回應宣告的 Content-Type，僅供交叉比對，不代表真實格式）。 */
export interface DownloadedImage {
  buffer: Buffer;
  declaredContentType: string | undefined;
  finalUrl: string;
}

/** 取標頭首值（Node 標頭可能為陣列）。 */
function headerValue(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * SSRF 防護下載：逐跳驗證協定 + host allowlist + 解析 IP（任一位址落硬封鎖範圍即拒絕），
 * redirect 上限內追蹤（每一跳重驗），Content-Length 預檢與串流累積皆受 maxBytes 限制。
 */
export async function downloadImage(
  rawUrl: string,
  opts: DownloadImageOptions,
): Promise<DownloadedImage> {
  const resolver = opts.resolver ?? defaultResolver;
  const transport = opts.transport ?? nodeHttpTransport;
  const maxRedirects = opts.maxRedirects ?? MAX_IMPORT_REDIRECTS;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AttachmentImportError("HOST_NOT_ALLOWED", "無效的來源 URL");
  }

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    // 協定 + host allowlist（逐跳；redirect 目標同樣受檢）
    assertUrlAllowed(url, opts.allowlist);

    // DNS 解析 + IP 驗證（逐跳）：任一解析位址落硬封鎖範圍即拒絕（防 round-robin / rebinding）
    let addrs: string[];
    try {
      addrs = await resolver(url.hostname);
    } catch {
      throw new AttachmentImportError("DNS_FAILED", `無法解析來源 host：${url.hostname}`);
    }
    if (addrs.length === 0) {
      throw new AttachmentImportError("DNS_FAILED", `來源 host 無解析結果：${url.hostname}`);
    }
    for (const addr of addrs) {
      if (isForbiddenIp(addr)) {
        throw new AttachmentImportError("BLOCKED_ADDRESS", `來源解析到受封鎖位址：${url.hostname}`);
      }
    }
    const pinned = addrs[0]!;
    const family = net.isIP(pinned) || 4;

    const res = await transport(url, { pinnedAddress: pinned, family, timeoutMs: opts.timeoutMs });

    // redirect：重驗下一跳（不讀 body）
    if (res.status >= 300 && res.status < 400) {
      res.discard?.();
      if (hop >= maxRedirects) {
        throw new AttachmentImportError("TOO_MANY_REDIRECTS", "redirect 次數過多");
      }
      const loc = headerValue(res.headers["location"]);
      if (!loc) throw new AttachmentImportError("HTTP_ERROR", `redirect 缺少 Location（${res.status}）`);
      const next = resolveRedirectTarget(url, loc);
      if (!next) throw new AttachmentImportError("HTTP_ERROR", "無法解析 redirect 目標");
      url = next;
      continue;
    }

    if (res.status < 200 || res.status >= 300) {
      res.discard?.();
      throw new AttachmentImportError("HTTP_ERROR", `來源回應狀態 ${res.status}`);
    }

    // Content-Length 預檢：宣告即超限時不下載
    const declaredLength = Number(headerValue(res.headers["content-length"]));
    if (Number.isFinite(declaredLength) && declaredLength > opts.maxBytes) {
      res.discard?.();
      throw new AttachmentImportError("FILE_TOO_LARGE", "來源宣告內容超過大小上限");
    }

    const buffer = await readCapped(res.body, opts.maxBytes);
    return {
      buffer,
      declaredContentType: headerValue(res.headers["content-type"]),
      finalUrl: url.toString(),
    };
  }
  throw new AttachmentImportError("TOO_MANY_REDIRECTS", "redirect 次數過多");
}

// ── 匯入編排（權限 → 下載 → 內容驗證 → 存附件 → Markdown） ──────────────────

export interface ImportAttachmentInput {
  pageId: string;
  sourceUrl: string;
  /** 建議檔名（正規化後以真實格式副檔名結尾）；省略時退回 "image"。 */
  filename?: string;
  /** Markdown 圖片 alt 文字。 */
  altText?: string;
  /** 呼叫端預期的 Content-Type；提供時須與嗅探出的真實格式一致，否則拒絕。 */
  expectedContentType?: string;
}

export interface ImportedAttachment {
  attachmentId: string;
  filename: string;
  contentType: string;
  size: number;
  url: string;
  markdown: string;
}

export type ImportAttachmentFailureCode = AttachmentImportErrorCode | "NOT_FOUND";

export type ImportAttachmentResult =
  | { ok: true; attachment: ImportedAttachment }
  | { ok: false; code: ImportAttachmentFailureCode; message: string };

/** 錯誤碼 → 使用者訊息（絕不夾帶來源 URL／憑證）。 */
const IMPORT_MESSAGES: Record<ImportAttachmentFailureCode, string> = {
  NOT_FOUND: "頁面不存在或無權寫入。",
  HOST_NOT_ALLOWED:
    "來源網域不在允許清單內。請確認 JETBOOK_ATTACHMENT_IMPORT_HOSTS 已納入該來源，或改用被允許的來源。",
  PROTOCOL_NOT_ALLOWED: "只允許 http/https 來源。",
  BLOCKED_ADDRESS: "來源位址被安全政策封鎖（loopback／link-local／metadata／multicast）。",
  DNS_FAILED: "無法解析來源網域。",
  TOO_MANY_REDIRECTS: "來源 redirect 次數過多。",
  HTTP_ERROR: "來源回應非成功狀態。",
  CONTENT_TYPE_NOT_ALLOWED: "來源內容不是允許的圖片格式（僅 JPEG／PNG／GIF／WebP）。",
  CONTENT_MISMATCH: "來源宣告的類型與實際內容不符。",
  FILE_TOO_LARGE: "來源檔案超過大小上限。",
  FILE_EMPTY: "來源檔案為空。",
  TIMEOUT: "連線逾時。",
  DOWNLOAD_FAILED: "下載失敗。",
};

/** 安全取來源 host（記錄用；絕不記完整 URL──可能含 signed token）。 */
function safeHost(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return "(invalid)";
  }
}

/** 正規化 Markdown alt：移除會破壞語法的字元（`[`、`]`、換行）。 */
function normalizeAlt(alt: string | undefined): string {
  return (alt ?? "").replace(/[\r\n[\]]/g, " ").trim();
}

/**
 * 從 URL 匯入圖片為 JetBook 永久附件並綁定至指定 Page。
 * 不存在與無權一律 NOT_FOUND（防枚舉，與 page-write 一致）。
 * deps 供測試注入 fake resolver／transport 與 allowlist（免真實網路與 loopback 例外）。
 */
export async function importAttachmentFromUrl(
  user: Actor,
  input: ImportAttachmentInput,
  deps?: { resolver?: HostResolver; transport?: ImportTransport; allowlist?: readonly string[] },
): Promise<ImportAttachmentResult> {
  // 1. 頁面存在性 + 寫入權限（群組／外部連結節點無內文，視同不存在）
  const page = await db.query.pages.findFirst({ where: eq(pages.id, input.pageId) });
  if (!page || page.deletedAt || page.kind !== "page") {
    return { ok: false, code: "NOT_FOUND", message: IMPORT_MESSAGES.NOT_FOUND };
  }
  if (!(await can(user, "page.edit", { type: "page", spaceId: page.spaceId }))) {
    return { ok: false, code: "NOT_FOUND", message: IMPORT_MESSAGES.NOT_FOUND };
  }

  // 2. SSRF 防護下載
  let downloaded: DownloadedImage;
  try {
    downloaded = await downloadImage(input.sourceUrl, {
      allowlist: deps?.allowlist ?? env.JETBOOK_ATTACHMENT_IMPORT_HOSTS,
      maxBytes: maxUploadBytes(),
      timeoutMs: IMPORT_TIMEOUT_MS,
      resolver: deps?.resolver,
      transport: deps?.transport,
    });
  } catch (error) {
    if (error instanceof AttachmentImportError) {
      logger.warn(
        { userId: user.id, pageId: page.id, host: safeHost(input.sourceUrl), code: error.code },
        "attachment import from url rejected",
      );
      return { ok: false, code: error.code, message: IMPORT_MESSAGES[error.code] };
    }
    throw error;
  }

  if (downloaded.buffer.byteLength === 0) {
    return { ok: false, code: "FILE_EMPTY", message: IMPORT_MESSAGES.FILE_EMPTY };
  }

  // 3. 內容驗證：magic bytes 判真實格式（不信副檔名／header）
  const sniffed = sniffImage(downloaded.buffer);
  if (!sniffed) {
    return {
      ok: false,
      code: "CONTENT_TYPE_NOT_ALLOWED",
      message: IMPORT_MESSAGES.CONTENT_TYPE_NOT_ALLOWED,
    };
  }
  // 交叉比對：回應宣告的圖片 Content-Type 若與真實格式相牴觸即拒絕（宣告非圖片則以嗅探為準，不阻擋）
  if (isAllowedImageMime(downloaded.declaredContentType)) {
    const declared = downloaded.declaredContentType!.split(";")[0]!.trim().toLowerCase();
    if (declared !== sniffed.mime) {
      return { ok: false, code: "CONTENT_MISMATCH", message: IMPORT_MESSAGES.CONTENT_MISMATCH };
    }
  }
  if (input.expectedContentType) {
    const expected = input.expectedContentType.split(";")[0]!.trim().toLowerCase();
    if (expected !== sniffed.mime) {
      return { ok: false, code: "CONTENT_MISMATCH", message: IMPORT_MESSAGES.CONTENT_MISMATCH };
    }
  }

  // 4. 存入既有附件管線（雙白名單 + UUID 檔名 + sha256 + StorageProvider + DB；失敗自動回收檔案）
  const filename = normalizeImportFilename(input.filename, sniffed.ext);
  const attachment = await saveAttachment({
    spaceId: page.spaceId,
    pageId: page.id,
    uploaderId: user.id,
    fileName: filename,
    mimeType: sniffed.mime,
    data: downloaded.buffer,
  });

  const url = `/api/files/${attachment.id}`;
  const markdown = `![${normalizeAlt(input.altText)}](${url})`;

  await writeAudit({
    actorId: user.id,
    action: "attachment.import_url",
    targetType: "attachment",
    targetId: attachment.id,
    metadata: {
      spaceId: page.spaceId,
      pageId: page.id,
      fileName: attachment.fileName,
      sizeBytes: attachment.sizeBytes,
      sourceHost: safeHost(input.sourceUrl), // 只記 host，不記完整 URL（可能含 signed token）
    },
    ip: null,
  });
  logger.info(
    { userId: user.id, pageId: page.id, attachmentId: attachment.id },
    "attachment imported from url",
  );

  return {
    ok: true,
    attachment: {
      attachmentId: attachment.id,
      filename: attachment.fileName,
      contentType: attachment.mimeType,
      size: attachment.sizeBytes,
      url,
      markdown,
    },
  };
}
