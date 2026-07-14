import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { verifyApiToken } from "@/lib/api-tokens";
import { checkApiTokenRate } from "@/lib/api-tokens/bearer";
import type { Actor } from "@/lib/authz/permission";
import { API_WRITE_MARKDOWN_MAX_CHARS, apiCreatePage, apiUpdatePage } from "@/lib/api/page-write";
import { apiCreateSpace } from "@/lib/api/space-write";
import { mcpListSpaces, mcpReadPage, mcpSearchPages } from "@/lib/mcp/tools";

/**
 * MCP Server（M4-07，F-API-04）：streamable HTTP（/api/mcp），stateless、可平移 K8s。
 * 認證：Bearer API token（M4-06；個人設定建立）。工具結果權限完全受 token 擁有者
 * 約束（lib/authz）——每位使用者須用自己的 token，禁止共用 admin token。
 * SSE 傳輸需 Redis session，本專案不引入（constraints），僅支援 streamable HTTP。
 */

/** 從 MCP 呼叫脈絡取出 token 擁有者（withMcpAuth 驗證時塞入 extra.user）。 */
function actorFrom(extra: unknown): Actor {
  const user = (extra as { authInfo?: { extra?: { user?: Actor } } }).authInfo?.extra?.user;
  if (!user) throw new Error("UNAUTHENTICATED");
  return user;
}

function mcpError(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

type WriteGate = { ok: true } | { ok: false; result: ReturnType<typeof mcpError> };

/**
 * 寫入工具的統一閘門（M4-09）：withMcpAuth 只保證 read；write scope 與
 * 每-token 限流（與 REST 共用同一 limiter 與額度）在此逐工具強制。
 * 新增寫入工具一律先過 writeGate，不得手寫散裝檢查。
 */
function writeGate(extra: unknown): WriteGate {
  const authInfo = (extra as { authInfo?: { scopes?: string[]; extra?: { tokenId?: string } } })
    .authInfo;
  if (!authInfo?.scopes?.includes("write")) {
    return {
      ok: false,
      result: mcpError(
        "此 token 沒有 write scope，無法寫入。請在 JetBook「個人設定 → API Token」建立勾選「允許寫入」的 token。",
      ),
    };
  }
  const tokenId = authInfo.extra?.tokenId;
  if (tokenId) {
    const rate = checkApiTokenRate(tokenId);
    if (!rate.allowed) {
      return {
        ok: false,
        result: mcpError(`請求過於頻繁，請於 ${rate.retryAfterSeconds} 秒後再試。`),
      };
    }
  }
  return { ok: true };
}

const handler = createMcpHandler(
  (server) => {
    server.tool(
      "search_pages",
      "搜尋 JetBook 知識庫（全文檢索，支援中文）。回傳符合的頁面清單（pageId、標題、空間、內容片段）；之後可用 read_page 讀取完整內容。",
      {
        query: z.string().min(1).describe("搜尋關鍵字"),
        limit: z.number().int().min(1).max(20).optional().describe("回傳筆數上限（預設 10）"),
      },
      async ({ query, limit }, extra) => {
        const hits = await mcpSearchPages(actorFrom(extra), query, limit ?? 10);
        if (hits.length === 0) {
          return { content: [{ type: "text" as const, text: "沒有符合的結果。" }] };
        }
        const text = hits
          .map(
            (h, i) =>
              `${i + 1}. ${h.title}（空間：${h.spaceName}）\n   pageId: ${h.pageId}\n   ${h.snippet}`,
          )
          .join("\n\n");
        return { content: [{ type: "text" as const, text }] };
      },
    );

    server.tool(
      "read_page",
      "讀取 JetBook 單一頁面的完整內容（Markdown）。pageId 取自 search_pages 的結果。",
      { pageId: z.string().uuid().describe("頁面 id（UUID）") },
      async ({ pageId }, extra) => {
        const page = await mcpReadPage(actorFrom(extra), pageId);
        if (!page) {
          return {
            content: [{ type: "text" as const, text: "頁面不存在或無權存取。" }],
            isError: true,
          };
        }
        const text = `# ${page.title}\n（空間：${page.spaceName}；更新：${page.updatedAt.toISOString()}）\n\n${page.contentMd}`;
        return { content: [{ type: "text" as const, text }] };
      },
    );

    server.tool(
      "create_page",
      "在指定空間建立新頁面（Markdown 內容）。spaceId 取自 list_spaces；需要 write scope 的 token。回傳新頁面的 pageId 與網址路徑。",
      {
        spaceId: z.string().uuid().describe("目標空間 id（UUID，取自 list_spaces）"),
        title: z.string().min(1).max(200).describe("頁面標題"),
        markdown: z.string().min(1).max(API_WRITE_MARKDOWN_MAX_CHARS).describe("頁面內容（Markdown）"),
        parentId: z.string().uuid().optional().describe("父頁面 id（省略＝根層）"),
      },
      async ({ spaceId, title, markdown, parentId }, extra) => {
        const gate = writeGate(extra);
        if (!gate.ok) return gate.result;
        const outcome = await apiCreatePage(actorFrom(extra), {
          spaceId,
          title,
          markdown,
          parentId: parentId ?? null,
        });
        if (!outcome.ok) return mcpError("空間/父頁面不存在或無權寫入。");
        const p = outcome.page;
        return {
          content: [
            {
              type: "text" as const,
              text: `已建立「${p.title}」\npageId: ${p.id}\n路徑: /s/${p.spaceSlug}/${p.slug}`,
            },
          ],
        };
      },
    );

    server.tool(
      "update_page",
      "部分更新既有頁面：markdown（全量取代內容，留版本快照可還原）與 title（改名）至少提供一項；expectedVersion 選填做樂觀鎖。pageId 取自 search_pages/read_page；需要 write scope 的 token。",
      {
        pageId: z.string().uuid().describe("頁面 id（UUID）"),
        markdown: z
          .string()
          .min(1)
          .max(API_WRITE_MARKDOWN_MAX_CHARS)
          .optional()
          .describe("新的頁面內容（Markdown，全量取代）；省略＝僅改標題"),
        title: z.string().trim().min(1).max(200).optional().describe("新標題；省略＝不變"),
        expectedVersion: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("樂觀鎖：呼叫端已知的版本號（read_page 可得），不符時拒絕以免覆蓋他人變更"),
      },
      async ({ pageId, markdown, title, expectedVersion }, extra) => {
        const gate = writeGate(extra);
        if (!gate.ok) return gate.result;
        if (markdown === undefined && title === undefined) {
          return mcpError("markdown 與 title 至少需提供一項。");
        }
        const outcome = await apiUpdatePage(actorFrom(extra), {
          pageId,
          markdown,
          title,
          expectedVersion,
        });
        if (!outcome.ok) {
          if (outcome.error === "LOCKED")
            return mcpError(`頁面正由 ${outcome.lockedByName ?? "他人"} 編輯中，稍後再試。`);
          if (outcome.error === "CONFLICT")
            return mcpError(
              `版本不符（目前版本 ${outcome.currentVersionNo}），請重新 read_page 後再試。`,
            );
          return mcpError("頁面不存在或無權寫入。");
        }
        const p = outcome.page;
        return {
          content: [
            {
              type: "text" as const,
              text: `已更新「${p.title}」（版本 ${p.versionNo}）\n路徑: /s/${p.spaceSlug}/${p.slug}`,
            },
          ],
        };
      },
    );

    server.tool(
      "create_space",
      "建立新的知識空間。slug 由系統自動產生（重名自動加尾碼）；建立者自動成為該空間管理員。需要 write scope 的 token。",
      {
        name: z.string().trim().min(1).max(100).describe("空間名稱"),
        description: z.string().trim().max(500).optional().describe("空間描述（選填）"),
      },
      async ({ name, description }, extra) => {
        const gate = writeGate(extra);
        if (!gate.ok) return gate.result;
        const space = await apiCreateSpace(actorFrom(extra), { name, description });
        return {
          content: [
            {
              type: "text" as const,
              text: `已建立空間「${space.name}」\nspaceId: ${space.id}\nslug: ${space.slug}`,
            },
          ],
        };
      },
    );

    server.tool(
      "list_spaces",
      "列出呼叫者可存取的 JetBook 知識空間（id、slug、名稱、描述）。",
      {},
      async (_args, extra) => {
        const rows = await mcpListSpaces(actorFrom(extra));
        const text =
          rows.length === 0
            ? "沒有可存取的空間。"
            : rows.map((s) => `- ${s.name}（slug: ${s.slug}）${s.description ? ` — ${s.description}` : ""}`).join("\n");
        return { content: [{ type: "text" as const, text }] };
      },
    );
  },
  {},
  { basePath: "/api", verboseLogs: false, maxDuration: 60 },
);

/** Bearer token 驗證：失敗回 undefined → 401（withMcpAuth required）。 */
const authHandler = withMcpAuth(
  handler,
  async (_req, token) => {
    if (!token) return undefined;
    const auth = await verifyApiToken(token);
    if (!auth || !auth.scopes.includes("read")) return undefined;
    return {
      token,
      scopes: auth.scopes,
      clientId: auth.user.id,
      extra: { user: auth.user, tokenId: auth.tokenId },
    };
  },
  { required: true },
);

export { authHandler as GET, authHandler as POST, authHandler as DELETE };
