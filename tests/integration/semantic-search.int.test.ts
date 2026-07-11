import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { pageEmbeddings } from "@/lib/db/schema";
import type { EmbeddingProvider } from "@/lib/llm";
import { semanticSearch } from "@/lib/search/semantic";
import { addMember, seedPage, seedSpace, seedUser } from "./helpers";

/**
 * I-05 語意搜尋整合測試（真 PG + pgvector，N-01／N-04 出貨閘門）。
 *
 * semanticSearch 委派 I-01 retrieve()（僅向量路），本測試驗證其頁級去重與權限一致性：
 * - F-AI-06：近義表述命中未含原詞的頁（僅靠向量鄰近，全文不命中）。
 * - private space 對非成員絕不出現（SQL 層權限過濾）。
 * - ai_indexing_enabled=false 的 space 排除（requireAiIndexing 於來源過濾）。
 * - 同頁多 chunk 去重為單一頁級結果。
 *
 * query 向量以注入假 provider 提供（確定性）；chunk 向量直接插入 page_embeddings。
 */

const DIMS = 1024;

/** 標準基底單位向量 e_i：不同 i 之間 cosine 距離＝1，同 i＝0。 */
function basis(i: number): number[] {
  const v = new Array<number>(DIMS).fill(0);
  v[i] = 1;
  return v;
}

/** 兩基底線性組合（未正規化）：製造「近但不同」的向量。 */
function blend(i: number, wi: number, j: number, wj: number): number[] {
  const v = new Array<number>(DIMS).fill(0);
  v[i] = wi;
  v[j] = wj;
  return v;
}

/** 回傳固定 query 向量的假 embedding provider。 */
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
  overrides: { chunkText?: string } = {},
) {
  const suffix = randomUUID().slice(0, 8);
  const chunkText = overrides.chunkText ?? `chunk-${suffix}`;
  await db.insert(pageEmbeddings).values({
    pageId,
    chunkIndex,
    contentHash: createHash("sha256").update(chunkText).digest("hex"),
    headingPath: "",
    chunkText,
    tokenCount: 10,
    embedding,
  });
}

describe("semanticSearch（I-05 語意搜尋 · 真 PG）", () => {
  it("F-AI-06：近義表述命中未含原詞的頁（僅向量路）", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_read", aiIndexingEnabled: true });

    // 內文完全不含查詢詞「筆記型電腦」，但其 chunk 向量與 query 對齊 → 全文不命中、語意命中。
    const near = await seedPage(space.id, {
      title: "行動裝置採購指南",
      contentText: "本頁討論可攜式運算設備的選購要點。",
    });
    const far = await seedPage(space.id, {
      title: "行政流程",
      contentText: "請假與報銷步驟。",
    });
    await insertChunk(near.id, 0, basis(5), { chunkText: "可攜式運算設備選購" });
    await insertChunk(far.id, 0, basis(300));

    const hits = await semanticSearch(owner, "筆記型電腦", {
      spaceId: space.id,
      provider: fakeProvider(basis(5)),
    });

    expect(hits[0]?.pageId).toBe(near.id);
    expect(hits[0]?.title).toBe("行動裝置採購指南");
    // 頁級形狀完整
    expect(hits[0]?.spaceSlug).toBe(space.slug);
    expect(hits[0]?.spaceName).toBe(space.name);
    expect(hits[0]?.slug).toBe(near.slug);
    expect(hits[0]?.snippet).toContain("可攜式運算設備");
    expect(typeof hits[0]?.score).toBe("number");
  });

  it("權限過濾：非成員搜不到 private space 的語意結果", async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    const priv = await seedSpace(owner.id, { visibility: "private", aiIndexingEnabled: true });
    await addMember(priv.id, owner.id, "editor");

    const secret = await seedPage(priv.id, { title: "機密配方", contentText: "" });
    await insertChunk(secret.id, 0, basis(7), { chunkText: "營業秘密" });

    const q = fakeProvider(basis(7));

    const ownerHits = await semanticSearch(owner, "查詢", { provider: q });
    expect(ownerHits.some((h) => h.pageId === secret.id)).toBe(true);

    const strangerHits = await semanticSearch(stranger, "查詢", { provider: q });
    expect(strangerHits.some((h) => h.pageId === secret.id)).toBe(false);
  });

  it("ai_indexing_enabled=false 的 space 一律排除（即使向量最近）", async () => {
    const owner = await seedUser();
    const disabled = await seedSpace(owner.id, { visibility: "org_read", aiIndexingEnabled: false });
    const enabled = await seedSpace(owner.id, { visibility: "org_read", aiIndexingEnabled: true });

    const hidden = await seedPage(disabled.id, { title: "關閉索引頁", contentText: "" });
    const visible = await seedPage(enabled.id, { title: "開啟索引頁", contentText: "" });
    await insertChunk(hidden.id, 0, basis(9));
    await insertChunk(visible.id, 0, blend(9, 0.6, 301, 0.4));

    const hits = await semanticSearch(owner, "查詢", {
      provider: fakeProvider(basis(9)),
      limit: 20,
    });

    expect(hits.some((h) => h.pageId === hidden.id)).toBe(false);
    expect(hits.some((h) => h.pageId === visible.id)).toBe(true);
  });

  it("同頁多 chunk 去重為單一頁級結果", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_read", aiIndexingEnabled: true });

    const page = await seedPage(space.id, { title: "多段頁", contentText: "" });
    await insertChunk(page.id, 0, basis(13), { chunkText: "第一段" });
    await insertChunk(page.id, 1, blend(13, 0.95, 14, 0.05), { chunkText: "第二段" });

    const hits = await semanticSearch(owner, "查詢", {
      spaceId: space.id,
      provider: fakeProvider(basis(13)),
    });

    expect(hits.filter((h) => h.pageId === page.id)).toHaveLength(1);
  });

  it("空查詢回空陣列", async () => {
    const owner = await seedUser();
    expect(await semanticSearch(owner, "   ", { provider: fakeProvider(basis(1)) })).toEqual([]);
  });
});
