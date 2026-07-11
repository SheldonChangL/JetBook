import { createHash, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { pageEmbeddings, pages, spaces } from "@/lib/db/schema";
import { OpenAICompatEmbeddingProvider } from "@/lib/llm/embedding";
import { embedPage } from "@/lib/rag/indexer";
import { seedSpace, seedUser } from "./helpers";

/**
 * H-06 嵌入索引管線整合測試（真 PG + pgvector，N-01）。
 * 以 node:http mock OpenAI-compatible /v1/embeddings 端點（確定性 1024 維向量：
 * 文字 sha256 展開）驗證真 HTTP 路徑，真實端點由部署 env 接上。
 *
 * 涵蓋驗收：
 * - 存頁 → page_embeddings 有列（每 chunk 一列，1024 維）
 * - 改一段 → 僅該 chunk 的 content_hash 與 updated_at 變動（content_hash 增量）
 * - 內容變短 → 孤兒 chunk 清除
 * - 空間關閉 AI 索引 / 軟刪 → 清除向量
 * - 硬刪頁面 → 列消失（FK cascade）
 */

const DIMS = 1024;

/** 文字 → 確定性 1024 維向量（同文字同向量，供比對穩定）。 */
function deterministicVector(text: string): number[] {
  const out: number[] = [];
  let hash = createHash("sha256").update(text).digest();
  while (out.length < DIMS) {
    for (const byte of hash) {
      out.push((byte / 255) * 2 - 1);
      if (out.length >= DIMS) break;
    }
    hash = createHash("sha256").update(hash).digest();
  }
  return out;
}

let server: Server;
let provider: OpenAICompatEmbeddingProvider;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const parsed = JSON.parse(body) as { input: string[] };
      const data = parsed.input.map((text, index) => ({
        index,
        embedding: deterministicVector(text),
      }));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data, usage: { prompt_tokens: 1 } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl =
    typeof address === "object" && address ? `http://127.0.0.1:${address.port}` : "";
  provider = new OpenAICompatEmbeddingProvider({ baseUrl, model: "bge-m3", dimensions: DIMS });
});

afterAll(() => server.close());

const THREE_SECTIONS = [
  "# 雷射對位規範",
  "",
  "雷射對位需在無塵室完成，公差不得超過五微米。",
  "",
  "# 光學鍍膜流程",
  "",
  "鍍膜前需清洗基板並確認真空度達標。",
  "",
  "# 品質檢驗標準",
  "",
  "每批次抽驗比例為百分之十，並記錄於系統。",
].join("\n");

/** 直接插入帶 content_md 的頁面（seedPage 不含 content_md）。 */
async function insertPage(spaceId: string, contentMd: string) {
  const suffix = randomUUID().slice(0, 8);
  const [page] = await db
    .insert(pages)
    .values({
      spaceId,
      slug: `emb-${suffix}`,
      title: `嵌入測試頁 ${suffix}`,
      contentMd,
      position: "a0",
    })
    .returning();
  if (!page) throw new Error("insertPage failed");
  return page;
}

async function readRows(pageId: string) {
  return db
    .select({
      chunkIndex: pageEmbeddings.chunkIndex,
      contentHash: pageEmbeddings.contentHash,
      updatedAt: pageEmbeddings.updatedAt,
    })
    .from(pageEmbeddings)
    .where(eq(pageEmbeddings.pageId, pageId))
    .orderBy(pageEmbeddings.chunkIndex);
}

describe("embedPage（嵌入索引管線 · 真 PG + mock 端點）", () => {
  it("存頁後每 chunk 一列（1024 維），content_hash 落地", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { aiIndexingEnabled: true });
    const page = await insertPage(space.id, THREE_SECTIONS);

    const result = await embedPage(page.id, { provider });
    expect(result.status).toBe("indexed");
    expect(result.chunks).toBe(3);
    expect(result.embedded).toBe(3);
    expect(result.reused).toBe(0);

    const rows = await readRows(page.id);
    expect(rows.map((r) => r.chunkIndex)).toEqual([0, 1, 2]);
    expect(rows.every((r) => r.contentHash.length === 64)).toBe(true);

    // 向量以 1024 維存入：直接查 pgvector 維度確認。
    const dim = await db.execute<{ dims: number }>(sql`
      SELECT vector_dims(embedding) AS dims FROM page_embeddings
      WHERE page_id = ${page.id} LIMIT 1`);
    expect(Number(dim.rows[0]?.dims)).toBe(DIMS);
  });

  it("內容未變：全 chunk 沿用舊向量，updated_at 不變", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { aiIndexingEnabled: true });
    const page = await insertPage(space.id, THREE_SECTIONS);

    await embedPage(page.id, { provider });
    const before = await readRows(page.id);

    const result = await embedPage(page.id, { provider });
    expect(result.embedded).toBe(0);
    expect(result.reused).toBe(3);

    const after = await readRows(page.id);
    for (let i = 0; i < 3; i += 1) {
      expect(after[i]!.contentHash).toBe(before[i]!.contentHash);
      expect(after[i]!.updatedAt.getTime()).toBe(before[i]!.updatedAt.getTime());
    }
  });

  it("改一段：僅該 chunk 的 content_hash 與 updated_at 變動（增量重嵌）", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { aiIndexingEnabled: true });
    const page = await insertPage(space.id, THREE_SECTIONS);

    await embedPage(page.id, { provider });
    const before = await readRows(page.id);

    // 只改第二段（chunk index 1）內容
    const edited = THREE_SECTIONS.replace(
      "鍍膜前需清洗基板並確認真空度達標。",
      "鍍膜前需以電漿清洗基板，並確認真空度達到十的負六次方托。",
    );
    await db.update(pages).set({ contentMd: edited }).where(eq(pages.id, page.id));
    await new Promise((r) => setTimeout(r, 10)); // 確保 updated_at 可測差異

    const result = await embedPage(page.id, { provider });
    expect(result.embedded).toBe(1);
    expect(result.reused).toBe(2);

    const after = await readRows(page.id);
    // chunk 1 變：hash 與 updated_at 皆變
    expect(after[1]!.contentHash).not.toBe(before[1]!.contentHash);
    expect(after[1]!.updatedAt.getTime()).toBeGreaterThan(before[1]!.updatedAt.getTime());
    // chunk 0、2 不變
    for (const i of [0, 2]) {
      expect(after[i]!.contentHash).toBe(before[i]!.contentHash);
      expect(after[i]!.updatedAt.getTime()).toBe(before[i]!.updatedAt.getTime());
    }
  });

  it("內容變短：孤兒 chunk 清除", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { aiIndexingEnabled: true });
    const page = await insertPage(space.id, THREE_SECTIONS);
    await embedPage(page.id, { provider });
    expect((await readRows(page.id)).length).toBe(3);

    await db
      .update(pages)
      .set({ contentMd: "# 只剩一節\n\n精簡後只保留這一段。" })
      .where(eq(pages.id, page.id));
    const result = await embedPage(page.id, { provider });
    expect(result.chunks).toBe(1);
    expect(result.removed).toBe(2);

    const rows = await readRows(page.id);
    expect(rows.map((r) => r.chunkIndex)).toEqual([0]);
  });

  it("空間關閉 AI 索引：清除既有向量", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { aiIndexingEnabled: true });
    const page = await insertPage(space.id, THREE_SECTIONS);
    await embedPage(page.id, { provider });
    expect((await readRows(page.id)).length).toBe(3);

    await db
      .update(spaces)
      .set({ aiIndexingEnabled: false })
      .where(eq(spaces.id, space.id));

    const result = await embedPage(page.id, { provider });
    expect(result.status).toBe("skipped-disabled");
    expect((await readRows(page.id)).length).toBe(0);
  });

  it("軟刪頁面：清除向量", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { aiIndexingEnabled: true });
    const page = await insertPage(space.id, THREE_SECTIONS);
    await embedPage(page.id, { provider });
    expect((await readRows(page.id)).length).toBe(3);

    await db.update(pages).set({ deletedAt: new Date() }).where(eq(pages.id, page.id));
    const result = await embedPage(page.id, { provider });
    expect(result.status).toBe("skipped-deleted");
    expect((await readRows(page.id)).length).toBe(0);
  });

  it("硬刪頁面：向量隨 FK cascade 消失", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { aiIndexingEnabled: true });
    const page = await insertPage(space.id, THREE_SECTIONS);
    await embedPage(page.id, { provider });
    expect((await readRows(page.id)).length).toBe(3);

    await db.delete(pages).where(eq(pages.id, page.id));
    const remaining = await db
      .select({ id: pageEmbeddings.id })
      .from(pageEmbeddings)
      .where(eq(pageEmbeddings.pageId, page.id));
    expect(remaining.length).toBe(0);
  });
});
