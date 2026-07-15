import { Readable } from "node:stream";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { attachments, auditLogs, pages } from "@/lib/db/schema";
import { apiCreatePage, apiUpdatePage } from "@/lib/api/page-write";
import {
  importAttachmentFromUrl,
  type HostResolver,
  type ImportHttpResponse,
  type ImportTransport,
} from "@/lib/storage/import-url";
import { getStorageProvider } from "@/lib/storage/provider";
import { mcpListSpaces, mcpReadPage } from "@/lib/mcp/tools";
import type { ProseMirrorNode } from "@/lib/content/types";
import { addMember, seedPage, seedSpace, seedUser } from "./helpers";

/**
 * 圖片匯入整合測試（真 PG，issue #237）：
 * (A) 寫入路徑內部附件 URL → image 節點往返；(B) import_attachment_from_url 伺服器端匯入
 * 的成功/權限/SSRF/內容驗證/無孤兒；(C) list_spaces 仍回 spaceId。
 * 網路依賴以注入的 fake transport/resolver 取代（免真實網路與 loopback 例外）。
 */

const ALLOW = ["images.test", "internal.test"];

function bodyOf(...chunks: Buffer[]): AsyncIterable<Buffer> {
  return (async function* gen() {
    for (const c of chunks) yield c;
  })();
}

type FakeRes = { status: number; headers?: Record<string, string>; body?: () => AsyncIterable<Buffer> };

function seqTransport(responses: FakeRes[]): ImportTransport {
  let i = 0;
  return async () => {
    const r = responses[Math.min(i, responses.length - 1)]!;
    i += 1;
    const res: ImportHttpResponse = {
      status: r.status,
      headers: r.headers ?? {},
      body: r.body ? r.body() : bodyOf(),
      discard: () => {},
    };
    return res;
  };
}

function resolverOf(map: Record<string, string[]> = {}): HostResolver {
  return async (host) => map[host] ?? ["93.184.216.34"];
}

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 0xab)]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(120, 0x22),
]);
const WEBP = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from("WEBP"),
  Buffer.alloc(60, 0x33),
]);

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/** 遞迴尋找指定型別的節點。 */
function findNode(node: ProseMirrorNode, type: string): ProseMirrorNode | null {
  if (node.type === type) return node;
  for (const child of node.content ?? []) {
    const found = findNode(child, type);
    if (found) return found;
  }
  return null;
}

/** 建立一個呼叫者可寫入的頁面（editor 成員）。 */
async function seedWritablePage() {
  const user = await seedUser();
  const space = await seedSpace(user.id);
  await addMember(space.id, user.id, "editor");
  const page = await seedPage(space.id);
  return { user, space, page };
}

const UID = "65584dfd-a4b9-42d0-b0a4-3d4a6eec6273";

describe("(A) 圖片 Markdown 往返（寫入路徑 resolver）", () => {
  it("create_page 保存內部圖片 markdown，read_page 完整讀回並含 image 節點", async () => {
    const { user, space } = await seedWritablePage();
    const md = `# 標題\n\n![Screenshot](/api/files/${UID})`;
    const created = await apiCreatePage(user, { spaceId: space.id, title: "圖片頁", markdown: md });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // 讀回完整保留圖片語法
    const read = await mcpReadPage(user, created.page.id);
    expect(read?.contentMd).toContain(`![Screenshot](/api/files/${UID})`);

    // canonical JSON 確含 image 節點（src 為內部 URL）
    const row = await db.query.pages.findFirst({ where: eq(pages.id, created.page.id) });
    const imageNode = findNode(row!.content as ProseMirrorNode, "image");
    expect(imageNode?.attrs).toMatchObject({ src: `/api/files/${UID}`, alt: "Screenshot" });
  });

  it("update_page 保存圖片 markdown，read_page 完整讀回", async () => {
    const { user, space } = await seedWritablePage();
    const created = await apiCreatePage(user, { spaceId: space.id, title: "頁", markdown: "初始" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const md = `![圖一](/api/files/${UID})`;
    const updated = await apiUpdatePage(user, { pageId: created.page.id, markdown: md });
    expect(updated.ok).toBe(true);

    const read = await mcpReadPage(user, created.page.id);
    expect(read?.contentMd).toContain(`![圖一](/api/files/${UID})`);
  });

  it("一般連結（無驚嘆號）不被當成圖片；外部圖片降級為連結", async () => {
    const { user, space } = await seedWritablePage();
    const md = `[報告](/api/files/${UID})\n\n![外部](https://redmine.example/a.jpg)`;
    const created = await apiCreatePage(user, { spaceId: space.id, title: "混合", markdown: md });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const read = await mcpReadPage(user, created.page.id);
    // 一般連結維持連結（非 image）
    expect(read?.contentMd).toContain(`[報告](/api/files/${UID})`);
    expect(read?.contentMd).not.toContain(`![報告](/api/files/${UID})`);
    // 外部圖片降級為連結（無 `!` 前綴）
    expect(read?.contentMd).toContain("[外部](https://redmine.example/a.jpg)");
    expect(read?.contentMd).not.toContain("![外部](https://redmine.example/a.jpg)");
  });

  it("版本衝突（樂觀鎖）不覆蓋他人變更", async () => {
    const { user, space } = await seedWritablePage();
    const created = await apiCreatePage(user, { spaceId: space.id, title: "頁", markdown: "v1" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // 以過期版本號寫入 → CONFLICT，內容不變
    const stale = created.page.versionNo - 1;
    const conflict = await apiUpdatePage(user, {
      pageId: created.page.id,
      markdown: `![x](/api/files/${UID})`,
      expectedVersion: stale,
    });
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.error).toBe("CONFLICT");

    const read = await mcpReadPage(user, created.page.id);
    expect(read?.contentMd).toContain("v1");
    expect(read?.contentMd).not.toContain("/api/files/");
  });
});

describe("(B) import_attachment_from_url 伺服器端匯入", () => {
  it("匯入 JPEG 成功：URL 屬 JetBook、綁定頁面、bytes/型別/大小一致", async () => {
    const { user, space, page } = await seedWritablePage();
    const result = await importAttachmentFromUrl(
      user,
      {
        pageId: page.id,
        sourceUrl: "https://images.test/redmine/attachments/download/16523/shot.jpg",
        filename: "Screenshot 2024-02-16 172806.jpg",
        altText: "Screenshot",
      },
      {
        allowlist: ALLOW,
        resolver: resolverOf(),
        transport: seqTransport([
          { status: 200, headers: { "content-type": "image/jpeg" }, body: () => bodyOf(JPEG) },
        ]),
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const a = result.attachment;
    // URL 屬 JetBook 內部，而非原始 Redmine URL
    expect(a.url).toBe(`/api/files/${a.attachmentId}`);
    expect(a.markdown).toBe(`![Screenshot](/api/files/${a.attachmentId})`);
    expect(a.contentType).toBe("image/jpeg");
    expect(a.filename).toBe("Screenshot 2024-02-16 172806.jpg");
    expect(a.size).toBe(JPEG.byteLength);

    // DB row 綁定到頁面與空間
    const row = await db.query.attachments.findFirst({ where: eq(attachments.id, a.attachmentId) });
    expect(row?.pageId).toBe(page.id);
    expect(row?.spaceId).toBe(space.id);
    expect(row?.mimeType).toBe("image/jpeg");
    expect(row?.sizeBytes).toBe(JPEG.byteLength);

    // 實際下載儲存內容 → bytes 一致
    const stored = await streamToBuffer(await getStorageProvider().getStream(row!.storageKey));
    expect(stored.equals(JPEG)).toBe(true);

    // 稽核記錄，且僅記 host 不記完整 URL（不洩漏憑證）
    const audit = await db.query.auditLogs.findFirst({
      where: and(eq(auditLogs.targetId, a.attachmentId), eq(auditLogs.action, "attachment.import_url")),
    });
    expect(audit).toBeTruthy();
    expect(JSON.stringify(audit?.metadata)).toContain("images.test");
    expect(JSON.stringify(audit?.metadata)).not.toContain("/download/16523/");
  });

  it("匯入 PNG 與 WebP 成功", async () => {
    const { user, page } = await seedWritablePage();
    for (const [buf, ct] of [
      [PNG, "image/png"],
      [WEBP, "image/webp"],
    ] as const) {
      const result = await importAttachmentFromUrl(
        user,
        { pageId: page.id, sourceUrl: "https://images.test/x", altText: "" },
        {
          allowlist: ALLOW,
          resolver: resolverOf(),
          transport: seqTransport([{ status: 200, headers: { "content-type": ct }, body: () => bodyOf(buf) }]),
        },
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.attachment.contentType).toBe(ct);
    }
  });

  it("無寫入權限 → NOT_FOUND，且不建立附件", async () => {
    const outsider = await seedUser();
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "private" });
    const page = await seedPage(space.id);

    const result = await importAttachmentFromUrl(
      outsider,
      { pageId: page.id, sourceUrl: "https://images.test/x" },
      {
        allowlist: ALLOW,
        resolver: resolverOf(),
        transport: seqTransport([{ status: 200, body: () => bodyOf(JPEG) }]),
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_FOUND");

    const rows = await db.query.attachments.findMany({ where: eq(attachments.pageId, page.id) });
    expect(rows.length).toBe(0);
  });

  it("host 不在 allowlist → HOST_NOT_ALLOWED，不建立附件", async () => {
    const { user, page } = await seedWritablePage();
    const result = await importAttachmentFromUrl(
      user,
      { pageId: page.id, sourceUrl: "https://evil.test/x.jpg" },
      {
        allowlist: ALLOW,
        resolver: resolverOf(),
        transport: seqTransport([{ status: 200, body: () => bodyOf(JPEG) }]),
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("HOST_NOT_ALLOWED");
    const rows = await db.query.attachments.findMany({ where: eq(attachments.pageId, page.id) });
    expect(rows.length).toBe(0);
  });

  it("redirect 到禁止位址 → BLOCKED_ADDRESS", async () => {
    const { user, page } = await seedWritablePage();
    const result = await importAttachmentFromUrl(
      user,
      { pageId: page.id, sourceUrl: "https://images.test/a.jpg" },
      {
        allowlist: ALLOW,
        resolver: resolverOf({ "images.test": ["1.2.3.4"], "internal.test": ["127.0.0.1"] }),
        transport: seqTransport([
          { status: 302, headers: { location: "https://internal.test/secret" } },
          { status: 200, body: () => bodyOf(JPEG) },
        ]),
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("BLOCKED_ADDRESS");
  });

  it("Content-Length 宣告超上限 → FILE_TOO_LARGE", async () => {
    const { user, page } = await seedWritablePage();
    const result = await importAttachmentFromUrl(
      user,
      { pageId: page.id, sourceUrl: "https://images.test/big.jpg" },
      {
        allowlist: ALLOW,
        resolver: resolverOf(),
        transport: seqTransport([
          {
            status: 200,
            headers: { "content-type": "image/jpeg", "content-length": String(1024 * 1024 * 1024) },
            body: () => bodyOf(JPEG),
          },
        ]),
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FILE_TOO_LARGE");
  });

  it("Content-Type 與實際內容不符 → CONTENT_MISMATCH", async () => {
    const { user, page } = await seedWritablePage();
    // 實際是 PNG，但預期 image/jpeg
    const result = await importAttachmentFromUrl(
      user,
      { pageId: page.id, sourceUrl: "https://images.test/x", expectedContentType: "image/jpeg" },
      {
        allowlist: ALLOW,
        resolver: resolverOf(),
        transport: seqTransport([{ status: 200, headers: { "content-type": "image/png" }, body: () => bodyOf(PNG) }]),
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("CONTENT_MISMATCH");
  });

  it("非圖片內容（HTML）→ CONTENT_TYPE_NOT_ALLOWED，不建立附件", async () => {
    const { user, page } = await seedWritablePage();
    const html = Buffer.from("<!DOCTYPE html><html><body>not an image</body></html>");
    const result = await importAttachmentFromUrl(
      user,
      { pageId: page.id, sourceUrl: "https://images.test/x" },
      {
        allowlist: ALLOW,
        resolver: resolverOf(),
        transport: seqTransport([{ status: 200, headers: { "content-type": "text/html" }, body: () => bodyOf(html) }]),
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("CONTENT_TYPE_NOT_ALLOWED");
    const rows = await db.query.attachments.findMany({ where: eq(attachments.pageId, page.id) });
    expect(rows.length).toBe(0);
  });

  it("下載中斷 → 失敗且不留孤兒附件", async () => {
    const { user, page } = await seedWritablePage();
    const brokenBody = () =>
      (async function* gen() {
        yield Buffer.from([0xff, 0xd8, 0xff]);
        throw new Error("connection dropped");
      })();
    const result = await importAttachmentFromUrl(
      user,
      { pageId: page.id, sourceUrl: "https://images.test/x" },
      {
        allowlist: ALLOW,
        resolver: resolverOf(),
        transport: seqTransport([{ status: 200, headers: { "content-type": "image/jpeg" }, body: brokenBody }]),
      },
    );
    expect(result.ok).toBe(false);
    const rows = await db.query.attachments.findMany({ where: eq(attachments.pageId, page.id) });
    expect(rows.length).toBe(0);
  });

  it("匯入後以回傳 markdown 更新頁面，read_page 往返內部圖片語法（端到端）", async () => {
    const { user, space, page } = await seedWritablePage();
    const imported = await importAttachmentFromUrl(
      user,
      { pageId: page.id, sourceUrl: "https://images.test/x", altText: "Screenshot" },
      {
        allowlist: ALLOW,
        resolver: resolverOf(),
        transport: seqTransport([{ status: 200, headers: { "content-type": "image/jpeg" }, body: () => bodyOf(JPEG) }]),
      },
    );
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;

    const updated = await apiUpdatePage(user, { pageId: page.id, markdown: imported.attachment.markdown });
    expect(updated.ok).toBe(true);

    const read = await mcpReadPage(user, page.id);
    expect(read?.contentMd).toContain(imported.attachment.markdown);
    expect(read?.spaceId).toBe(space.id);
  });
});

describe("(C) list_spaces 仍回真正的 spaceId", () => {
  it("mcpListSpaces 每筆含 UUID spaceId", async () => {
    const user = await seedUser();
    const space = await seedSpace(user.id);
    await addMember(space.id, user.id, "viewer");
    const rows = await mcpListSpaces(user);
    const hit = rows.find((s) => s.id === space.id);
    expect(hit).toBeTruthy();
    expect(hit?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });
});

// downloadImage 的純網路防護細節（協定/超跳/DNS 空）另於 src/lib/storage/import-url.test.ts 單元覆蓋。
