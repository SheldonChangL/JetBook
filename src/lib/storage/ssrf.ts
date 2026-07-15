import net from "node:net";

/**
 * SSRF 防護的**純邏輯層**（無網路／DB／server-only 相依，可單元測試）。
 *
 * 供 `import-url.ts` 的伺服器端 URL 匯入使用。設計原則：
 * - 預設拒絕：來源 host 必須在明確 allowlist（env JETBOOK_ATTACHMENT_IMPORT_HOSTS）內，
 *   否則一律拒絕。allowlist 是「開放私有網段」的唯一授權途徑——被列入者即代表管理者信任
 *   其（可能為內網／私有 IP）位址。
 * - 硬性封鎖（即使 host 在 allowlist 亦拒絕）：loopback、link-local（含 cloud metadata
 *   169.254.169.254）、multicast、未指定／保留／broadcast。這些對「具名內網來源」永遠不合法，
 *   是縱深防禦的地板。
 * - 私有網段（10/8、172.16/12、192.168/16、CGNAT、ULA…）不在硬封鎖內：僅在 host 通過
 *   allowlist 時才可達（內網 Redmine 即此情境）；非 allowlist 的 host 連 host 閘門都過不了。
 */

/** URL 匯入的錯誤碼（對映使用者訊息時不得洩漏憑證／signed URL）。 */
export type AttachmentImportErrorCode =
  | "HOST_NOT_ALLOWED"
  | "PROTOCOL_NOT_ALLOWED"
  | "BLOCKED_ADDRESS"
  | "DNS_FAILED"
  | "TOO_MANY_REDIRECTS"
  | "HTTP_ERROR"
  | "CONTENT_TYPE_NOT_ALLOWED"
  | "CONTENT_MISMATCH"
  | "FILE_TOO_LARGE"
  | "FILE_EMPTY"
  | "TIMEOUT"
  | "DOWNLOAD_FAILED";

/** URL 匯入失敗；code 供呼叫端對映安全訊息（絕不夾帶來源憑證）。 */
export class AttachmentImportError extends Error {
  constructor(
    public readonly code: AttachmentImportErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AttachmentImportError";
  }
}

/** redirect 追蹤上限（含首次請求外的跳轉次數）。 */
export const MAX_IMPORT_REDIRECTS = 3;

/** 允許的傳輸協定（預設只允許 http/https）。 */
const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"]);

/**
 * 硬性封鎖網段（永遠拒絕）。以 net.BlockList 精確判斷 CIDR，不用字串前綴猜測。
 * IPv4-mapped IPv6（::ffff:a.b.c.d）在 isForbiddenIp 內先正規化為 IPv4 再比對。
 */
const HARD_BLOCK = new net.BlockList();
// IPv4
HARD_BLOCK.addSubnet("0.0.0.0", 8, "ipv4"); // 本網路／未指定
HARD_BLOCK.addSubnet("127.0.0.0", 8, "ipv4"); // loopback
HARD_BLOCK.addSubnet("169.254.0.0", 16, "ipv4"); // link-local（含 cloud metadata 169.254.169.254）
HARD_BLOCK.addSubnet("224.0.0.0", 4, "ipv4"); // multicast
HARD_BLOCK.addSubnet("240.0.0.0", 4, "ipv4"); // 保留（含 255.255.255.255 broadcast）
// IPv6
HARD_BLOCK.addAddress("::", "ipv6"); // 未指定
HARD_BLOCK.addAddress("::1", "ipv6"); // loopback
HARD_BLOCK.addSubnet("fe80::", 10, "ipv6"); // link-local
HARD_BLOCK.addSubnet("ff00::", 8, "ipv6"); // multicast

const IPV4_MAPPED = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i;

/**
 * 該 IP 是否屬於硬性封鎖範圍（loopback／link-local／multicast／保留／未指定）。
 * 非法輸入或無法判斷一律回 true（fail-closed）。IPv4-mapped IPv6 先攤平為 IPv4 再比對，
 * 避免 `::ffff:127.0.0.1` 之類繞過。
 */
export function isForbiddenIp(ip: string): boolean {
  const trimmed = ip.trim();
  const mapped = IPV4_MAPPED.exec(trimmed);
  // IPv4-mapped IPv6 僅接受可解析的點分形式（::ffff:a.b.c.d）；其餘 ::ffff: 壓縮 hex 形
  // （如 ::ffff:7f00:1）一律 fail-closed——正常 resolver 不回傳此形，出現即視為規避企圖。
  if (!mapped && /^::ffff:/i.test(trimmed)) return true;
  const addr = mapped ? mapped[1]! : trimmed;
  const family = net.isIP(addr);
  if (family === 0) return true; // 非合法 IP：fail-closed
  try {
    return HARD_BLOCK.check(addr, family === 4 ? "ipv4" : "ipv6");
  } catch {
    return true;
  }
}

/**
 * 解析 allowlist 環境變數（逗號分隔的 host 清單）→ 正規化（小寫、去空白、去尾點、去 port）。
 * 未設定或空字串 → 空陣列（＝預設拒絕全部）。
 */
export function parseImportHosts(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((h) => normalizeHost(h))
    .filter((h) => h.length > 0);
}

/** 正規化單一 host：小寫、去頭尾空白、去尾端點、剝除 :port（若有）。 */
function normalizeHost(host: string): string {
  let h = host.trim().toLowerCase();
  if (!h) return "";
  // 去尾端點（FQDN 絕對形式 example.com.）
  h = h.replace(/\.$/, "");
  // 剝除 port（僅對「非 IPv6 字面」；IPv6 字面含多個冒號，此處來源為設定 host 名，忽略）
  if (!h.includes("::") && h.split(":").length === 2) {
    h = h.split(":")[0]!;
  }
  return h;
}

/** host 是否在 allowlist 內（精確比對，不做子網域展開——避免意外放行子網域）。 */
export function isHostAllowed(host: string, allowlist: readonly string[]): boolean {
  const h = normalizeHost(host);
  if (!h) return false;
  return allowlist.some((allowed) => normalizeHost(allowed) === h);
}

/**
 * 驗證單一請求 URL（協定 + host allowlist）；不做 DNS（DNS/IP 於呼叫端非同步驗證）。
 * 每一跳（含 redirect 目標）都必須先過此關。失敗擲 AttachmentImportError。
 */
export function assertUrlAllowed(url: URL, allowlist: readonly string[]): void {
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new AttachmentImportError("PROTOCOL_NOT_ALLOWED", `不允許的協定：${url.protocol}`);
  }
  if (!isHostAllowed(url.hostname, allowlist)) {
    // 不回顯完整 URL（可能含 signed token）；僅列 host
    throw new AttachmentImportError("HOST_NOT_ALLOWED", `來源 host 不在允許清單：${url.hostname}`);
  }
}

/**
 * 解析 redirect 目標為絕對 URL（相對 Location 依當前 URL 解析）。無法解析回 null。
 */
export function resolveRedirectTarget(current: URL, location: string): URL | null {
  try {
    return new URL(location, current);
  } catch {
    return null;
  }
}
