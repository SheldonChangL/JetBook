import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { pageEmbeddings } from "@/lib/db/schema";
import type { EmbeddingProvider } from "@/lib/llm";
import { retrieve } from "@/lib/rag/retriever";
import { addMember, seedPage, seedSpace, seedUser } from "./helpers";

/**
 * I-01 Hybrid Retriever 整合測試（真 PG + pgvector + pgroonga，N-01／N-04 出貨閘門）。
 *
 * 直接插入確定性向量（不需 mock embedding 端點）；query 向量以注入的假 provider 提供。
 * 涵蓋驗收：
 * - 語意近鄰命中（向量路 cosine 排序）
 * - 私有 space 的 chunk 對非成員絕不出現（SQL 層權限過濾）
 * - ai_indexing_enabled=false 的 space 排除（requireAiIndexing 於來源過濾）
 * - RRF 排序合理（雙路命中 chunk 分數高於單路命中）
 */

const DIMS = 1024;

/** 標準基底單位向量 e_i（1 於位置 i，其餘 0）：不同 i 之間 cosine 距離＝1，同 i＝0。 */
function basis(i: number): number[] {
  const v = new Array<number>(DIMS).fill(0);
  v[i] = 1;
  return v;
}

/** 兩基底線性組合（未正規化；cosine 只看方向，用來製造「近但不同」的向量）。 */
function blend(i: number, wi: number, j: number, wj: number): number[] {
  const v = new Array<number>(DIMS).fill(0);
  v[i] = wi;
  v[j] = wj;
  return v;
}

/** 回傳固定 query 向量的假 embedding provider（retrieve 只呼叫 embed(query,"query")）。 */
function fakeProvider(queryVector: number[]): EmbeddingProvider {
  return {
    model: "fake-test",
    dimensions: DIMS,
    async embed(texts: string[]): Promise<number[][]> {
      return texts.map(() => queryVector);
    },
  };
}

/** 直接插入一列 page_embeddings（帶指定確定性向量）。 */
async function insertChunk(
  pageId: string,
  chunkIndex: number,
  embedding: number[],
  overrides: { headingPath?: string; chunkText?: string } = {},
) {
  const suffix = randomUUID().slice(0, 8);
  const chunkText = overrides.chunkText ?? `chunk-${suffix}`;
  await db.insert(pageEmbeddings).values({
    pageId,
    chunkIndex,
    contentHash: createHash("sha256").update(chunkText).digest("hex"),
    headingPath: overrides.headingPath ?? "",
    chunkText,
    tokenCount: 10,
    embedding,
  });
}

describe("retrieve（Hybrid Retriever · 真 PG）", () => {
  it("語意近鄰命中：query 向量最近的 chunk 排第一", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_read", aiIndexingEnabled: true });

    const near = await seedPage(space.id, { title: "近鄰頁", contentText: "" });
    const far1 = await seedPage(space.id, { title: "遠頁一", contentText: "" });
    const far2 = await seedPage(space.id, { title: "遠頁二", contentText: "" });

    await insertChunk(near.id, 0, basis(5), { chunkText: "最相關內容" });
    await insertChunk(far1.id, 0, basis(100));
    await insertChunk(far2.id, 0, basis(200));

    // query 向量＝e_5（與 near 的 chunk 距離 0）；content_text 皆空 → 全文路不命中。
    // 限定本 space 以隔離共用 DB 內其他測試的 org_read 資料。
    const hits = await retrieve(owner, "任意語意查詢", {
      spaceId: space.id,
      provider: fakeProvider(basis(5)),
    });

    expect(hits.length).toBe(3);
    expect(hits[0]?.pageId).toBe(near.id);
    expect(hits[0]?.title).toBe("近鄰頁");
    expect(hits[0]?.chunkText).toBe("最相關內容");
    // 回傳形狀完整
    expect(hits[0]?.spaceSlug).toBe(space.slug);
    expect(hits[0]?.pageSlug).toBe(near.slug);
    expect(typeof hits[0]?.score).toBe("number");
    expect(hits[0]!.score).toBeGreaterThan(0);
  });

  it("私有 space 的 chunk 對非成員絕不出現（成員可見）", async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    const priv = await seedSpace(owner.id, { visibility: "private", aiIndexingEnabled: true });
    await addMember(priv.id, owner.id, "editor");

    const secret = await seedPage(priv.id, { title: "機密配方", contentText: "" });
    await insertChunk(secret.id, 0, basis(7), { chunkText: "營業秘密" });

    const q = fakeProvider(basis(7));

    const ownerHits = await retrieve(owner, "查詢", { provider: q });
    expect(ownerHits.some((h) => h.pageId === secret.id)).toBe(true);

    const strangerHits = await retrieve(stranger, "查詢", { provider: q });
    expect(strangerHits.some((h) => h.pageId === secret.id)).toBe(false);
  });

  it("ai_indexing_enabled=false 的 space 一律排除（即使向量最近）", async () => {
    const owner = await seedUser();
    const disabled = await seedSpace(owner.id, {
      visibility: "org_read",
      aiIndexingEnabled: false,
    });
    const enabled = await seedSpace(owner.id, {
      visibility: "org_read",
      aiIndexingEnabled: true,
    });

    const hiddenPage = await seedPage(disabled.id, { title: "關閉索引頁", contentText: "" });
    const visiblePage = await seedPage(enabled.id, { title: "開啟索引頁", contentText: "" });

    // 關閉索引頁的 chunk 與 query 完全一致（距離 0）；開啟索引頁略遠。
    await insertChunk(hiddenPage.id, 0, basis(9));
    await insertChunk(visiblePage.id, 0, blend(9, 0.6, 300, 0.4));

    const hits = await retrieve(owner, "查詢", { provider: fakeProvider(basis(9)), limit: 50 });

    expect(hits.some((h) => h.pageId === hiddenPage.id)).toBe(false);
    // 開啟索引的頁仍可被檢索到
    expect(hits.some((h) => h.pageId === visiblePage.id)).toBe(true);
  });

  it("RRF 排序合理：雙路命中 chunk 分數高於單路命中", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_read", aiIndexingEnabled: true });

    // 雙路命中：全文含「光學鍍膜」＋向量最近。
    const both = await seedPage(space.id, {
      title: "光學鍍膜規範",
      contentText: "光學鍍膜製程與參數規範。",
    });
    // 僅向量命中：全文不含關鍵字，向量次近。
    const vectorOnly = await seedPage(space.id, { title: "純向量頁", contentText: "無關內容。" });
    // 僅全文命中：全文含關鍵字，向量最遠。
    const fulltextOnly = await seedPage(space.id, {
      title: "純全文頁",
      contentText: "光學鍍膜的另一份文件。",
    });

    await insertChunk(both.id, 0, basis(11), { chunkText: "雙路命中內容" });
    await insertChunk(vectorOnly.id, 0, blend(11, 0.7, 400, 0.3), { chunkText: "純向量內容" });
    await insertChunk(fulltextOnly.id, 0, basis(900), { chunkText: "純全文內容" });

    // query＝「光學鍍膜」：全文匹配 both/fulltextOnly；向量最近＝both。
    const hits = await retrieve(owner, "光學鍍膜", {
      provider: fakeProvider(basis(11)),
      limit: 50,
    });

    const byPage = new Map(hits.map((h) => [h.pageId, h]));
    // 雙路命中的頁排第一且分數最高
    expect(hits[0]?.pageId).toBe(both.id);
    const bothScore = byPage.get(both.id)!.score;
    const vectorOnlyScore = byPage.get(vectorOnly.id)!.score;
    const fulltextOnlyScore = byPage.get(fulltextOnly.id)!.score;
    expect(bothScore).toBeGreaterThan(vectorOnlyScore);
    expect(bothScore).toBeGreaterThan(fulltextOnlyScore);
    // 額外的全文訊號讓「向量較遠但全文命中」勝過「僅向量命中」
    expect(fulltextOnlyScore).toBeGreaterThan(vectorOnlyScore);
  });

  it("空查詢回空陣列", async () => {
    const owner = await seedUser();
    expect(await retrieve(owner, "   ", { provider: fakeProvider(basis(1)) })).toEqual([]);
  });
});
