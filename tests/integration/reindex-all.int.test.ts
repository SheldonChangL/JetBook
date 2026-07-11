import { createHash, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { pageEmbeddings, pages, spaces } from "@/lib/db/schema";
import { OpenAICompatEmbeddingProvider } from "@/lib/llm/embedding";
import type { EmbeddingProvider } from "@/lib/llm";
import { embedPage } from "@/lib/rag/indexer";
import { FAILED_SAMPLE_CAP, runReindexAll } from "@/lib/rag/reindex";
import { seedSpace, seedUser } from "./helpers";

/**
 * H-07 全庫重嵌整合測試（真 PG + pgvector，N-01）。
 * 以 node:http mock OpenAI-compatible /v1/embeddings 端點（確定性 1024 維向量）
 * 驗證真 HTTP 路徑；真實端點由部署 env 接上。
 *
 * 涵蓋任務驗收：2 space 各 2 頁 → 關掉其一的 ai_indexing → reindex →
 *   只剩另一 space 的向量、關閉者向量被徹底清除（NFR-COMP-03）。
 * 另驗：force 全量重算（換模型可重建 F-AI-02）、失敗清單與續跑、keyset 分批。
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

/** 兩節內容 → chunker 切成 2 個 chunk。 */
const TWO_SECTIONS = [
  "# 對位規範",
  "",
  "雷射對位需在無塵室完成，公差不得超過五微米。",
  "",
  "# 鍍膜流程",
  "",
  "鍍膜前需清洗基板並確認真空度達標。",
].join("\n");

/** 直接插入帶 content_md 的頁面（seedPage 不含 content_md）。 */
async function insertPage(spaceId: string, contentMd: string) {
  const suffix = randomUUID().slice(0, 8);
  const [page] = await db
    .insert(pages)
    .values({
      spaceId,
      slug: `reidx-${suffix}`,
      title: `重嵌測試頁 ${suffix}`,
      contentMd,
      position: "a0",
    })
    .returning();
  if (!page) throw new Error("insertPage failed");
  return page;
}

/** 統計某 space 底下所有頁面的向量列數。 */
async function countVectorsForSpace(spaceId: string): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(pageEmbeddings)
    .innerJoin(pages, eq(pageEmbeddings.pageId, pages.id))
    .where(eq(pages.spaceId, spaceId));
  return row?.c ?? 0;
}

async function updatedAtForSpace(spaceId: string): Promise<number[]> {
  const rows = await db
    .select({ updatedAt: pageEmbeddings.updatedAt })
    .from(pageEmbeddings)
    .innerJoin(pages, eq(pageEmbeddings.pageId, pages.id))
    .where(eq(pages.spaceId, spaceId));
  return rows.map((r) => r.updatedAt.getTime());
}

describe("runReindexAll（全庫重嵌 · 真 PG + mock 端點）", () => {
  it("2 space 各 2 頁：關掉其一 ai_indexing → reindex → 只剩另一 space、關閉者清除", async () => {
    const owner = await seedUser();
    const spaceKeep = await seedSpace(owner.id, { aiIndexingEnabled: true });
    const spaceOff = await seedSpace(owner.id, { aiIndexingEnabled: true });
    await insertPage(spaceKeep.id, TWO_SECTIONS);
    await insertPage(spaceKeep.id, TWO_SECTIONS);
    await insertPage(spaceOff.id, TWO_SECTIONS);
    await insertPage(spaceOff.id, TWO_SECTIONS);

    // 先讓兩個 space 都建立向量（模擬既有索引）。
    await runReindexAll({ provider, batchSize: 1 });
    const keepBefore = await countVectorsForSpace(spaceKeep.id);
    const offBefore = await countVectorsForSpace(spaceOff.id);
    expect(keepBefore).toBeGreaterThan(0);
    expect(offBefore).toBeGreaterThan(0);

    // 關閉其一的 AI 索引後重嵌。
    await db.update(spaces).set({ aiIndexingEnabled: false }).where(eq(spaces.id, spaceOff.id));
    const result = await runReindexAll({ provider, batchSize: 1 });

    expect(result.phase).toBe("completed");
    expect(result.total).toBeGreaterThanOrEqual(4);
    expect(result.purgedDisabledSpaces).toBeGreaterThanOrEqual(1);

    // 保留空間向量仍在（且數量與先前一致——被重算而非刪除）。
    expect(await countVectorsForSpace(spaceKeep.id)).toBe(keepBefore);
    // 關閉空間向量被徹底清除（NFR-COMP-03）。
    expect(await countVectorsForSpace(spaceOff.id)).toBe(0);
  });

  it("force 全量重算：內容未變，reindex 仍重打向量（換模型可重建 F-AI-02）", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { aiIndexingEnabled: true });
    const page = await insertPage(space.id, TWO_SECTIONS);

    // 先以增量路徑建立向量（非 force）。
    await embedPage(page.id, { provider });
    const before = await updatedAtForSpace(space.id);
    expect(before.length).toBeGreaterThan(0);

    await new Promise((r) => setTimeout(r, 15)); // 確保 updated_at 可測差異
    const result = await runReindexAll({ provider });
    expect(result.phase).toBe("completed");

    // force=true：每個 chunk 都重算，最早的新 updated_at 也晚於最晚的舊值（未沿用舊向量）。
    const after = await updatedAtForSpace(space.id);
    expect(after.length).toBe(before.length);
    expect(Math.min(...after)).toBeGreaterThan(Math.max(...before));
  });

  it("單頁嵌入失敗：續跑不中止，記入 failedCount 與 failed 樣本（上限）", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { aiIndexingEnabled: true });
    await insertPage(space.id, TWO_SECTIONS);
    await insertPage(space.id, TWO_SECTIONS);

    const throwing: EmbeddingProvider = {
      model: "broken",
      dimensions: DIMS,
      embed: async () => {
        throw new Error("mock embedding endpoint down");
      },
    };

    const result = await runReindexAll({ provider: throwing });
    // 每頁失敗但整體 job 完成（不因單頁失敗而中止）。
    expect(result.phase).toBe("completed");
    expect(result.failedCount).toBeGreaterThanOrEqual(2);
    expect(result.failed.length).toBeGreaterThan(0);
    expect(result.failed.length).toBeLessThanOrEqual(FAILED_SAMPLE_CAP);
  });
});
