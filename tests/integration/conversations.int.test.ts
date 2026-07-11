import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiConversations } from "@/lib/db/schema";
import type {
  ChatDelta,
  ChatParams,
  ChatResult,
  ChatStreamResult,
  ChatUsage,
  LLMProvider,
} from "@/lib/llm";
import type { Actor } from "@/lib/authz/permission";
import type { RetrievedChunk } from "@/lib/rag/retriever";
import type { ConversationSseEvent } from "@/lib/ai/conversation-chat";
import {
  QUERY_REWRITE_SYSTEM,
  TITLE_SYSTEM,
  runConversationChat,
} from "@/lib/ai/conversation-chat";
import {
  createConversation,
  getConversation,
  getConversationMessages,
  listConversations,
} from "@/lib/ai/conversations";
import { seedUser } from "./helpers";

/**
 * I-07 多輪對話與歷史整合測試（真 PG，N-01）。涵蓋：
 * - 新對話→續談的持久化：ai_conversations／ai_messages 落庫、來源快照、標題生成、
 *   續談載入歷史 + query rewrite + 訊息時間序（成對 user/assistant）。
 * - 權限：對話與訊息僅本人可讀（他人一律讀不到；歷史列表不含他人對話）。
 *
 * 檢索以注入的 retrieveFn 提供確定性 chunk（權限過濾另由 rag-isolation.int.test 涵蓋），
 * LLM 以假 provider（mock）驅動，聚焦本 issue 新增的對話持久化與擁有者隔離。
 */

function actorOf(id: string): Actor {
  return { id, orgRole: "member" };
}

function chunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    pageId: "00000000-0000-0000-0000-0000000000aa",
    chunkIndex: 0,
    headingPath: "章節",
    chunkText: "來源內容片段",
    score: 0.9,
    title: "來源標題",
    spaceSlug: "ops",
    spaceName: "維運空間",
    pageSlug: "doc",
    ...overrides,
  };
}

/** 假 provider：chatStream 逐 delta；chat 依 system 區分 rewrite／title。 */
class FakeProvider implements LLMProvider {
  readonly name = "fake";
  streamParams: ChatParams[] = [];
  constructor(
    private answer = "回答內容",
    private usage: ChatUsage = { inputTokens: 20, outputTokens: 6 },
    private rewritten = "改寫後查詢",
    private title = "對話標題",
  ) {}
  async *chatStream(params: ChatParams): AsyncGenerator<ChatDelta, ChatStreamResult> {
    this.streamParams.push(params);
    yield { type: "text", text: this.answer };
    return { usage: this.usage, model: "fake-model" };
  }
  async chat(params: ChatParams): Promise<ChatResult> {
    const text =
      params.system === QUERY_REWRITE_SYSTEM
        ? this.rewritten
        : params.system === TITLE_SYSTEM
          ? this.title
          : "";
    return { text, usage: { inputTokens: 4, outputTokens: 2 }, model: "light-model" };
  }
}

async function run(
  opts: Parameters<typeof runConversationChat>[0],
): Promise<{ events: ConversationSseEvent[]; conversationId: string }> {
  const events: ConversationSseEvent[] = [];
  const gen = runConversationChat(opts);
  let conversationId = "";
  for (;;) {
    const step = await gen.next();
    if (step.done) {
      conversationId = step.value.conversationId;
      break;
    }
    events.push(step.value);
  }
  return { events, conversationId };
}

describe("多輪對話持久化（真 PG）", () => {
  it("新對話→續談：訊息與來源快照落庫、標題生成、續談載入歷史 + query rewrite", async () => {
    const user = await seedUser();
    const provider = new FakeProvider("第一輪回答");
    const retrieveFn = vi.fn(async () => [chunk({ chunkText: "第一輪來源" })]);

    // 第一輪（新對話）
    const first = await run({
      actor: actorOf(user.id),
      question: "第一個問題",
      noResultsMessage: "查無",
      provider,
      retrieveFn,
    });
    const cid = first.conversationId;
    expect(first.events[0]).toEqual({ event: "conversation", data: { id: cid } });

    // 對話與標題落庫（標題由 light tier 生成後回填）。
    const conv = await getConversation(user.id, cid);
    expect(conv).not.toBeNull();
    expect(conv?.title).toBe("對話標題");

    // 第一輪訊息落庫：user（無來源）＋ assistant（帶來源快照）。
    const afterFirst = await getConversationMessages(user.id, cid);
    expect(afterFirst?.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(afterFirst?.messages[0]?.text).toBe("第一個問題");
    expect(afterFirst?.messages[0]?.sources).toEqual([]);
    expect(afterFirst?.messages[1]?.text).toBe("第一輪回答");
    expect(afterFirst?.messages[1]?.sources).toHaveLength(1);
    expect(afterFirst?.messages[1]?.sources[0]?.snippet).toContain("第一輪來源");

    // 第二輪（續談）：帶 conversationId → 載入歷史 + query rewrite 改寫後檢索。
    provider.streamParams.length = 0;
    const provider2 = provider; // 同一 provider 續用，累積 streamParams
    const second = await run({
      actor: actorOf(user.id),
      question: "那另一個呢？",
      conversationId: cid,
      noResultsMessage: "查無",
      provider: provider2,
      retrieveFn,
    });
    expect(second.conversationId).toBe(cid);

    // query rewrite 後以改寫查詢檢索（第二次 retrieve 呼叫）。
    expect(retrieveFn).toHaveBeenLastCalledWith(actorOf(user.id), "改寫後查詢", { spaceId: undefined });
    // 續談 chatStream messages 帶第一輪歷史脈絡（user/assistant）+ 當前提問。
    const streamMsgs = provider2.streamParams.at(-1)!.messages;
    expect(streamMsgs).toHaveLength(3);
    expect(streamMsgs[0]).toEqual({ role: "user", content: "第一個問題" });
    expect(streamMsgs[1]).toEqual({ role: "assistant", content: "第一輪回答" });
    expect(streamMsgs[2]?.content).toContain("那另一個呢？");

    // 訊息時間序（成對 user/assistant，共四則）。
    const afterSecond = await getConversationMessages(user.id, cid);
    expect(afterSecond?.messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(afterSecond?.messages.map((m) => m.text)).toEqual([
      "第一個問題",
      "第一輪回答",
      "那另一個呢？",
      "第一輪回答",
    ]);

    // 歷史列表含本對話。
    const list = await listConversations(user.id);
    expect(list.some((c) => c.id === cid)).toBe(true);
  });
});

describe("對話與訊息僅本人可讀（真 PG，權限隔離）", () => {
  it("他人的對話／訊息一律讀不到，歷史列表不含他人對話", async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    const retrieveFn = vi.fn(async () => [chunk()]);

    const { conversationId: cid } = await run({
      actor: actorOf(owner.id),
      question: "機密問題",
      noResultsMessage: "查無",
      provider: new FakeProvider(),
      retrieveFn,
    });

    // 擁有者可讀。
    expect(await getConversation(owner.id, cid)).not.toBeNull();
    expect((await getConversationMessages(owner.id, cid))?.messages.length).toBe(2);
    expect((await listConversations(owner.id)).some((c) => c.id === cid)).toBe(true);

    // 他人一律讀不到（getConversation／getConversationMessages 回 null）。
    expect(await getConversation(stranger.id, cid)).toBeNull();
    expect(await getConversationMessages(stranger.id, cid)).toBeNull();
    // 他人歷史列表不含本對話。
    expect((await listConversations(stranger.id)).some((c) => c.id === cid)).toBe(false);
  });

  it("歷史列表只顯示有訊息的對話（中斷未留言的空對話不列出）", async () => {
    const user = await seedUser();
    // 直接建立一個沒有任何訊息的空對話（模擬首問中斷）。
    const empty = await createConversation({ userId: user.id, spaceId: null, title: "空對話" });
    const list = await listConversations(user.id);
    expect(list.some((c) => c.id === empty.id)).toBe(false);
    // 且該空對話仍存在於資料表（僅是不列入歷史）。
    const rows = await db.select().from(aiConversations).where(eq(aiConversations.id, empty.id));
    expect(rows).toHaveLength(1);
  });
});
