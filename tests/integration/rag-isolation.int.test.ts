import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { pageEmbeddings, pages, spaces } from "@/lib/db/schema";
import type {
  ChatDelta,
  ChatStreamResult,
  EmbeddingProvider,
  LLMProvider,
} from "@/lib/llm";
import { retrieve } from "@/lib/rag/retriever";
import type { AnswerSource } from "@/lib/rag/answer";
import { addMember, seedPage, seedSpace, seedUser } from "./helpers";

/**
 * N-04 RAG 權限隔離自動化測試（M2 出貨阻斷 / release-blocker，NFR-SEC-05）。
 *
 * 本套件把「不可讀內容絕不進入檢索結果」升格為 CI 必跑的出貨閘門，涵蓋四類隔離：
 *   1. 私有 space 的非成員
 *   2. ai_indexing_enabled=false 的 space
 *   3. 軟刪除頁（pages.deleted_at）
 *   4. 封存 space（spaces.archived_at）
 *
 * 兩層驗證：
 *   A. retriever 層（retrieve()）——對「全查詢角度」驗證：
 *      - 被隔離內容以確定性向量 seed 成「向量最近 + 全文命中」的最強候選，
 *        仍須在 hybrid（雙路）與 semantic（純向量）兩模式、跨 space 與限定 space 兩範圍下皆不出現。
 *   B. /api/ai/chat route 層——直接呼叫 route handler，解析 SSE `sources` 事件，
 *      驗證引用來源同樣隔離（sources 不含被隔離頁）。
 *
 * 另驗 org admin 可見全部「合法可索引」內容（私有 space 亦然），但 admin 權限
 * 不得凌駕 ai_indexing/軟刪/封存 這三道全域排除（安全過濾對 admin 一視同仁）。
 *
 * query 向量以注入的假 embedding provider 提供（確定性）；chunk 向量直接插入
 * page_embeddings。route 層透過 mock 邊界（session/i18n/限流/用量/LLM）+ 真實
 * retrieve 對真 PG 檢索，確保走的是產線 SQL 層權限過濾路徑。
 */

const DIMS = 1024;

/** 標準基底單位向量 e_i（位置 i 為 1，其餘 0）：不同 i 之間 cosine 距離＝1，同 i＝0。 */
function basis(i: number): number[] {
  const v = new Array<number>(DIMS).fill(0);
  v[i] = 1;
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
  chunkText = `chunk-${randomUUID().slice(0, 8)}`,
) {
  await db.insert(pageEmbeddings).values({
    pageId,
    chunkIndex,
    contentHash: createHash("sha256").update(`${pageId}:${chunkIndex}:${chunkText}`).digest("hex"),
    headingPath: "",
    chunkText,
    tokenCount: 10,
    embedding,
  });
}

async function softDeletePage(pageId: string) {
  await db.update(pages).set({ deletedAt: new Date() }).where(eq(pages.id, pageId));
}

async function archiveSpace(spaceId: string) {
  await db.update(spaces).set({ archivedAt: new Date() }).where(eq(spaces.id, spaceId));
}

// ── Part B（route 層）邊界 mock ─────────────────────────────────────────────
// 只 mock 非受測邊界（session／i18n／限流／用量／audit／LLM 生成 + embedding），
// retrieve 與 streamChatAnswer 走真實實作對真 PG，確保驗到產線權限過濾路徑。

let currentActor: { id: string; orgRole: "admin" | "member" } | null = null;
/** route 內 retrieve 會呼叫 getEmbeddingProvider()；以此 mutable 向量注入確定性 query 向量。 */
let routeQueryVector: number[] = basis(0);

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) =>
    ({ noResults: "知識庫中找不到相關資訊。" })[key] ?? key,
}));

vi.mock("@/lib/auth/current", () => ({
  getCurrentSession: async () => (currentActor ? { user: currentActor } : null),
}));

vi.mock("@/lib/rate-limit", () => ({
  aiRateLimiter: { check: () => ({ allowed: true, retryAfterSeconds: 0 }) },
}));

vi.mock("@/lib/ai/usage", () => ({
  recordAiUsage: async () => {},
}));

vi.mock("@/lib/audit", () => ({
  ipFromHeaders: () => "10.0.0.1",
}));

class FakeLlm implements LLMProvider {
  readonly name = "fake";
  async *chatStream(): AsyncGenerator<ChatDelta, ChatStreamResult> {
    yield { type: "text", text: "答案" };
    return { usage: { inputTokens: 1, outputTokens: 1 }, model: "fake-model" };
  }
  async chat(): Promise<never> {
    throw new Error("未使用");
  }
}

vi.mock("@/lib/llm", () => ({
  isLlmConfigured: () => true,
  isEmbeddingConfigured: () => true,
  getLlmProvider: () => new FakeLlm(),
  getEmbeddingProvider: () => fakeProvider(routeQueryVector),
}));

// route 依賴上述 mock；於 mock 宣告後才 import。
import { POST } from "@/app/api/ai/chat/route";

/** 呼叫 /api/ai/chat 並回傳 SSE 的 sources 事件內容（引用來源）。 */
async function chatSources(question: string): Promise<AnswerSource[]> {
  const req = new Request("http://localhost/api/ai/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question }),
  });
  const res = await POST(req);
  expect(res.status).toBe(200);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  const sourcesBlock = text
    .split("\n\n")
    .filter((b) => b.trim().length > 0)
    .map((block) => {
      const lines = block.split("\n");
      const event = lines.find((l) => l.startsWith("event:"))!.slice(6).trim();
      const data = lines.find((l) => l.startsWith("data:"))!.slice(5).trim();
      return { event, data: JSON.parse(data) as unknown };
    })
    .find((e) => e.event === "sources");
  return (sourcesBlock?.data as AnswerSource[]) ?? [];
}

// ── Part A：retriever 層隔離（真 PG，全查詢角度）────────────────────────────

describe("RAG 隔離 · retriever 層（真 PG · N-04 出貨閘門）", () => {
  it("私有 space：非成員在 hybrid/semantic、跨 space/限定 space 皆檢索不到（成員可見）", async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    const priv = await seedSpace(owner.id, { visibility: "private", aiIndexingEnabled: true });
    await addMember(priv.id, owner.id, "editor");
    // 對照：非成員本身可讀的 org_read 已索引 space。
    const open = await seedSpace(stranger.id, { visibility: "org_read", aiIndexingEnabled: true });

    // 被隔離頁：向量最近 + 全文命中（最強候選），仍須被過濾。
    const secret = await seedPage(priv.id, { title: "機密配方", contentText: "隔離關鍵詞甲" });
    await insertChunk(secret.id, 0, basis(510), "隔離關鍵詞甲");
    const control = await seedPage(open.id, { title: "公開頁", contentText: "隔離關鍵詞甲" });
    await insertChunk(control.id, 0, basis(510), "隔離關鍵詞甲");

    const q = () => fakeProvider(basis(510));
    const opts = { provider: q(), limit: 50 } as const;

    // 跨 space · hybrid：非成員看不到 secret，但看得到自己可讀的 control。
    const strangerHybrid = await retrieve(stranger, "隔離關鍵詞甲", { ...opts });
    expect(strangerHybrid.some((h) => h.pageId === secret.id)).toBe(false);
    expect(strangerHybrid.some((h) => h.pageId === control.id)).toBe(true);

    // 跨 space · semantic（純向量）：同樣不得洩漏。
    const strangerSemantic = await retrieve(stranger, "隔離關鍵詞甲", { ...opts, mode: "semantic" });
    expect(strangerSemantic.some((h) => h.pageId === secret.id)).toBe(false);

    // 限定 secret 所在 space：非成員無任何可讀頁 → 空結果（不洩漏存在性）。
    const strangerScoped = await retrieve(stranger, "隔離關鍵詞甲", { ...opts, spaceId: priv.id });
    expect(strangerScoped).toEqual([]);

    // 成員（owner）可見。
    const ownerHits = await retrieve(owner, "隔離關鍵詞甲", { ...opts });
    expect(ownerHits.some((h) => h.pageId === secret.id)).toBe(true);
  });

  it("ai_indexing_enabled=false：對成員與 org admin 皆檢索不到（即使向量最近＋全文命中）", async () => {
    const owner = await seedUser();
    const admin = await seedUser({ orgRole: "admin" });
    const disabled = await seedSpace(owner.id, { visibility: "org_read", aiIndexingEnabled: false });
    const enabled = await seedSpace(owner.id, { visibility: "org_read", aiIndexingEnabled: true });

    const hidden = await seedPage(disabled.id, { title: "關閉索引頁", contentText: "隔離關鍵詞乙" });
    await insertChunk(hidden.id, 0, basis(520), "隔離關鍵詞乙");
    const visible = await seedPage(enabled.id, { title: "開啟索引頁", contentText: "隔離關鍵詞乙" });
    await insertChunk(visible.id, 0, basis(520), "隔離關鍵詞乙");

    const opts = { provider: fakeProvider(basis(520)), limit: 50 } as const;

    for (const user of [owner, admin]) {
      const hybrid = await retrieve(user, "隔離關鍵詞乙", { ...opts });
      expect(hybrid.some((h) => h.pageId === hidden.id)).toBe(false);
      expect(hybrid.some((h) => h.pageId === visible.id)).toBe(true);

      const semantic = await retrieve(user, "隔離關鍵詞乙", { ...opts, mode: "semantic" });
      expect(semantic.some((h) => h.pageId === hidden.id)).toBe(false);

      // 限定關閉索引的 space：requireAiIndexing 於來源排除 → 空結果。
      const scoped = await retrieve(user, "隔離關鍵詞乙", { ...opts, spaceId: disabled.id });
      expect(scoped).toEqual([]);
    }
  });

  it("軟刪除頁：對成員與 org admin 皆檢索不到（同 space 未刪頁仍可見）", async () => {
    const owner = await seedUser();
    const admin = await seedUser({ orgRole: "admin" });
    const space = await seedSpace(owner.id, { visibility: "org_read", aiIndexingEnabled: true });

    const deleted = await seedPage(space.id, { title: "已刪頁", contentText: "隔離關鍵詞丙" });
    await insertChunk(deleted.id, 0, basis(530), "隔離關鍵詞丙");
    const sibling = await seedPage(space.id, { title: "未刪頁", contentText: "隔離關鍵詞丙" });
    await insertChunk(sibling.id, 0, basis(530), "隔離關鍵詞丙");
    await softDeletePage(deleted.id);

    const opts = { provider: fakeProvider(basis(530)), limit: 50 } as const;

    for (const user of [owner, admin]) {
      const hybrid = await retrieve(user, "隔離關鍵詞丙", { ...opts });
      expect(hybrid.some((h) => h.pageId === deleted.id)).toBe(false);
      expect(hybrid.some((h) => h.pageId === sibling.id)).toBe(true);

      const semantic = await retrieve(user, "隔離關鍵詞丙", { ...opts, mode: "semantic" });
      expect(semantic.some((h) => h.pageId === deleted.id)).toBe(false);

      const scoped = await retrieve(user, "隔離關鍵詞丙", { ...opts, spaceId: space.id });
      expect(scoped.some((h) => h.pageId === deleted.id)).toBe(false);
      expect(scoped.some((h) => h.pageId === sibling.id)).toBe(true);
    }
  });

  it("封存 space：對成員與 org admin 皆檢索不到（即使向量最近＋全文命中）", async () => {
    const owner = await seedUser();
    const admin = await seedUser({ orgRole: "admin" });
    const archived = await seedSpace(owner.id, { visibility: "org_read", aiIndexingEnabled: true });
    const live = await seedSpace(owner.id, { visibility: "org_read", aiIndexingEnabled: true });

    const inArchived = await seedPage(archived.id, { title: "封存頁", contentText: "隔離關鍵詞丁" });
    await insertChunk(inArchived.id, 0, basis(540), "隔離關鍵詞丁");
    const inLive = await seedPage(live.id, { title: "現役頁", contentText: "隔離關鍵詞丁" });
    await insertChunk(inLive.id, 0, basis(540), "隔離關鍵詞丁");
    await archiveSpace(archived.id);

    const opts = { provider: fakeProvider(basis(540)), limit: 50 } as const;

    for (const user of [owner, admin]) {
      const hybrid = await retrieve(user, "隔離關鍵詞丁", { ...opts });
      expect(hybrid.some((h) => h.pageId === inArchived.id)).toBe(false);
      expect(hybrid.some((h) => h.pageId === inLive.id)).toBe(true);

      const semantic = await retrieve(user, "隔離關鍵詞丁", { ...opts, mode: "semantic" });
      expect(semantic.some((h) => h.pageId === inArchived.id)).toBe(false);

      const scoped = await retrieve(user, "隔離關鍵詞丁", { ...opts, spaceId: archived.id });
      expect(scoped).toEqual([]);
    }
  });

  it("org admin 可見全部合法內容（私有 space 亦然），但不凌駕 ai_indexing/軟刪/封存 排除", async () => {
    const owner = await seedUser();
    const admin = await seedUser({ orgRole: "admin" });
    const stranger = await seedUser();

    // 私有 space：admin 非成員，仍應可見；stranger 不可見。
    const priv = await seedSpace(owner.id, { visibility: "private", aiIndexingEnabled: true });
    await addMember(priv.id, owner.id, "editor");
    const secret = await seedPage(priv.id, { title: "私有機密", contentText: "全域關鍵詞" });
    await insertChunk(secret.id, 0, basis(550), "全域關鍵詞");

    // 三道全域排除：admin 亦不得見。
    const noIndex = await seedSpace(owner.id, { visibility: "org_read", aiIndexingEnabled: false });
    const noIndexPage = await seedPage(noIndex.id, { title: "關閉索引", contentText: "全域關鍵詞" });
    await insertChunk(noIndexPage.id, 0, basis(550), "全域關鍵詞");

    const normal = await seedSpace(owner.id, { visibility: "org_read", aiIndexingEnabled: true });
    const deletedPage = await seedPage(normal.id, { title: "已刪", contentText: "全域關鍵詞" });
    await insertChunk(deletedPage.id, 0, basis(550), "全域關鍵詞");
    await softDeletePage(deletedPage.id);

    const arch = await seedSpace(owner.id, { visibility: "org_read", aiIndexingEnabled: true });
    const archPage = await seedPage(arch.id, { title: "封存", contentText: "全域關鍵詞" });
    await insertChunk(archPage.id, 0, basis(550), "全域關鍵詞");
    await archiveSpace(arch.id);

    const opts = { provider: fakeProvider(basis(550)), limit: 50 } as const;

    const adminHits = await retrieve(admin, "全域關鍵詞", { ...opts });
    const adminIds = new Set(adminHits.map((h) => h.pageId));
    // 可見全部合法內容：私有 space 的機密頁 admin 可見。
    expect(adminIds.has(secret.id)).toBe(true);
    // 但三道全域排除 admin 一視同仁。
    expect(adminIds.has(noIndexPage.id)).toBe(false);
    expect(adminIds.has(deletedPage.id)).toBe(false);
    expect(adminIds.has(archPage.id)).toBe(false);

    // 非成員看不到私有機密（對照 admin 的「可見全部」）。
    const strangerHits = await retrieve(stranger, "全域關鍵詞", { ...opts });
    expect(strangerHits.some((h) => h.pageId === secret.id)).toBe(false);
  });
});

// ── Part B：/api/ai/chat route 層隔離（SSE sources）─────────────────────────

describe("RAG 隔離 · /api/ai/chat route 層（SSE sources · N-04 出貨閘門）", () => {
  beforeEach(() => {
    currentActor = null;
    routeQueryVector = basis(0);
  });

  it("私有 space：非成員的 chat sources 不含機密頁；成員含之", async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    const priv = await seedSpace(owner.id, { visibility: "private", aiIndexingEnabled: true });
    await addMember(priv.id, owner.id, "editor");
    const open = await seedSpace(stranger.id, { visibility: "org_read", aiIndexingEnabled: true });

    const secret = await seedPage(priv.id, { title: "機密", contentText: "路由關鍵詞甲" });
    await insertChunk(secret.id, 0, basis(560), "路由關鍵詞甲");
    const control = await seedPage(open.id, { title: "公開", contentText: "路由關鍵詞甲" });
    await insertChunk(control.id, 0, basis(560), "路由關鍵詞甲");

    routeQueryVector = basis(560);

    currentActor = { id: stranger.id, orgRole: "member" };
    const strangerSources = await chatSources("路由關鍵詞甲");
    expect(strangerSources.some((s) => s.pageId === secret.id)).toBe(false);
    expect(strangerSources.some((s) => s.pageId === control.id)).toBe(true);

    currentActor = { id: owner.id, orgRole: "member" };
    const ownerSources = await chatSources("路由關鍵詞甲");
    expect(ownerSources.some((s) => s.pageId === secret.id)).toBe(true);
  });

  it("ai_indexing_enabled=false：chat sources 不含該 space 內容", async () => {
    const owner = await seedUser();
    const disabled = await seedSpace(owner.id, { visibility: "org_read", aiIndexingEnabled: false });
    const enabled = await seedSpace(owner.id, { visibility: "org_read", aiIndexingEnabled: true });
    const hidden = await seedPage(disabled.id, { title: "關閉索引", contentText: "路由關鍵詞乙" });
    await insertChunk(hidden.id, 0, basis(570), "路由關鍵詞乙");
    const visible = await seedPage(enabled.id, { title: "開啟索引", contentText: "路由關鍵詞乙" });
    await insertChunk(visible.id, 0, basis(570), "路由關鍵詞乙");

    routeQueryVector = basis(570);
    currentActor = { id: owner.id, orgRole: "member" };
    const sources = await chatSources("路由關鍵詞乙");
    expect(sources.some((s) => s.pageId === hidden.id)).toBe(false);
    expect(sources.some((s) => s.pageId === visible.id)).toBe(true);
  });

  it("軟刪除頁：chat sources 不含已刪頁（同 space 未刪頁仍在）", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id, { visibility: "org_read", aiIndexingEnabled: true });
    const deleted = await seedPage(space.id, { title: "已刪", contentText: "路由關鍵詞丙" });
    await insertChunk(deleted.id, 0, basis(580), "路由關鍵詞丙");
    const sibling = await seedPage(space.id, { title: "未刪", contentText: "路由關鍵詞丙" });
    await insertChunk(sibling.id, 0, basis(580), "路由關鍵詞丙");
    await softDeletePage(deleted.id);

    routeQueryVector = basis(580);
    currentActor = { id: owner.id, orgRole: "member" };
    const sources = await chatSources("路由關鍵詞丙");
    expect(sources.some((s) => s.pageId === deleted.id)).toBe(false);
    expect(sources.some((s) => s.pageId === sibling.id)).toBe(true);
  });

  it("封存 space：chat sources 不含封存 space 內容", async () => {
    const owner = await seedUser();
    const archived = await seedSpace(owner.id, { visibility: "org_read", aiIndexingEnabled: true });
    const live = await seedSpace(owner.id, { visibility: "org_read", aiIndexingEnabled: true });
    const inArchived = await seedPage(archived.id, { title: "封存", contentText: "路由關鍵詞丁" });
    await insertChunk(inArchived.id, 0, basis(590), "路由關鍵詞丁");
    const inLive = await seedPage(live.id, { title: "現役", contentText: "路由關鍵詞丁" });
    await insertChunk(inLive.id, 0, basis(590), "路由關鍵詞丁");
    await archiveSpace(archived.id);

    routeQueryVector = basis(590);
    currentActor = { id: owner.id, orgRole: "member" };
    const sources = await chatSources("路由關鍵詞丁");
    expect(sources.some((s) => s.pageId === inArchived.id)).toBe(false);
    expect(sources.some((s) => s.pageId === inLive.id)).toBe(true);
  });

  it("org admin 的 chat sources 可含私有 space 機密頁（非成員則否）", async () => {
    const owner = await seedUser();
    const admin = await seedUser({ orgRole: "admin" });
    const stranger = await seedUser();
    const priv = await seedSpace(owner.id, { visibility: "private", aiIndexingEnabled: true });
    await addMember(priv.id, owner.id, "editor");
    const secret = await seedPage(priv.id, { title: "私有機密", contentText: "路由全域詞" });
    await insertChunk(secret.id, 0, basis(595), "路由全域詞");

    routeQueryVector = basis(595);

    currentActor = { id: admin.id, orgRole: "admin" };
    const adminSources = await chatSources("路由全域詞");
    expect(adminSources.some((s) => s.pageId === secret.id)).toBe(true);

    currentActor = { id: stranger.id, orgRole: "member" };
    const strangerSources = await chatSources("路由全域詞");
    expect(strangerSources.some((s) => s.pageId === secret.id)).toBe(false);
  });
});
