import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { verifyApiToken } from "@/lib/api-tokens";
import { checkApiTokenRate } from "@/lib/api-tokens/bearer";
import type { Actor } from "@/lib/authz/permission";
import {
  API_PAGE_TITLE_MAX_CHARS,
  API_WRITE_MARKDOWN_MAX_CHARS,
  apiCreatePage,
  apiDeletePage,
  apiMovePage,
  apiUpdatePage,
} from "@/lib/api/page-write";
import {
  SPACE_DESCRIPTION_MAX_CHARS,
  SPACE_NAME_MAX_CHARS,
  apiCreateSpace,
  apiSetSpaceMember,
  apiUpdateSpace,
} from "@/lib/api/space-write";
import { mcpListSpaces, mcpReadPage, mcpSearchPages } from "@/lib/mcp/tools";
import { importAttachmentFromUrl } from "@/lib/storage/import-url";

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
      "搜尋 JetBook 知識庫（全文檢索，支援中文）。回傳符合的頁面清單（pageId、spaceId、標題、空間、內容片段）；之後可用 read_page 讀取完整內容，或直接以 spaceId 呼叫 create_page 在同一空間建頁。",
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
              `${i + 1}. ${h.title}（空間：${h.spaceName}）\n   pageId: ${h.pageId}\n   spaceId: ${h.spaceId}\n   ${h.snippet}`,
          )
          .join("\n\n");
        return { content: [{ type: "text" as const, text }] };
      },
    );

    server.tool(
      "read_page",
      "讀取 JetBook 單一頁面的完整內容（Markdown）。pageId 取自 search_pages 的結果。回傳的 meta 含 pageId 與 spaceId，可直接用於 create_page（同空間建子頁：parentId 帶本頁 pageId）或 move_page。",
      { pageId: z.string().uuid().describe("頁面 id（UUID）") },
      async ({ pageId }, extra) => {
        const page = await mcpReadPage(actorFrom(extra), pageId);
        if (!page) {
          return {
            content: [{ type: "text" as const, text: "頁面不存在或無權存取。" }],
            isError: true,
          };
        }
        const text = `# ${page.title}\n（空間：${page.spaceName}；spaceId：${page.spaceId}；pageId：${page.id}；版本：${page.versionNo}；更新：${page.updatedAt.toISOString()}）\n\n${page.contentMd}`;
        return { content: [{ type: "text" as const, text }] };
      },
    );

    server.tool(
      "create_page",
      "在指定空間建立新頁面（Markdown 內容）。spaceId 取自 list_spaces、search_pages 或 read_page；需要 write scope 的 token。回傳新頁面的 pageId 與網址路徑。",
      {
        spaceId: z
          .string()
          .uuid()
          .describe("目標空間 id（UUID，取自 list_spaces／search_pages／read_page）"),
        title: z.string().trim().min(1).max(API_PAGE_TITLE_MAX_CHARS).describe("頁面標題"),
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
        title: z
          .string()
          .trim()
          .min(1)
          .max(API_PAGE_TITLE_MAX_CHARS)
          .optional()
          .describe("新標題；省略＝不變"),
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
      "import_attachment_from_url",
      "將外部圖片（如 Redmine 附件）伺服器端下載並存為 JetBook 永久附件，綁定到指定頁面，回傳可直接使用的內部 Markdown（![alt](/api/files/<id>)）。用途：把頁面內的外部圖片連結換成永久內嵌圖片——先以本工具逐一匯入取得內部 Markdown，再用 update_page 將頁面內容中的外部圖片語法替換為回傳的內部 Markdown。僅支援管理者允許清單內的來源網域（SSRF 防護），且僅接受 JPEG／PNG／GIF／WebP。不接受任意 Authorization header：若來源需登入，請改用來源系統產生的短效下載 URL。需要 write scope 的 token。",
      {
        pageId: z.string().uuid().describe("要綁定附件的頁面 id（UUID）；需對該頁有寫入權限"),
        sourceUrl: z
          .string()
          .min(1)
          .describe("圖片來源 URL（http/https；host 須在 JETBOOK_ATTACHMENT_IMPORT_HOSTS 允許清單內）"),
        filename: z
          .string()
          .trim()
          .max(255)
          .optional()
          .describe("建議檔名（副檔名會依實際內容自動校正）；省略＝image"),
        altText: z.string().trim().max(500).optional().describe("Markdown 圖片 alt 文字"),
        expectedContentType: z
          .string()
          .trim()
          .max(100)
          .optional()
          .describe("預期 Content-Type（如 image/jpeg）；提供時須與實際內容一致，否則拒絕"),
      },
      async ({ pageId, sourceUrl, filename, altText, expectedContentType }, extra) => {
        const gate = writeGate(extra);
        if (!gate.ok) return gate.result;
        const outcome = await importAttachmentFromUrl(actorFrom(extra), {
          pageId,
          sourceUrl,
          filename,
          altText,
          expectedContentType,
        });
        if (!outcome.ok) return mcpError(outcome.message);
        const a = outcome.attachment;
        return {
          content: [
            {
              type: "text" as const,
              text: `已匯入附件「${a.filename}」（${a.contentType}，${a.size} bytes）\nattachmentId: ${a.attachmentId}\nurl: ${a.url}\n可貼入頁面的 Markdown:\n${a.markdown}`,
            },
          ],
        };
      },
    );

    server.tool(
      "create_space",
      "建立新的知識空間。slug 由系統自動產生（重名自動加尾碼）；建立者自動成為該空間管理員。可設 visibility 決定誰看得到（省略＝private 僅成員可見）。需要 write scope 的 token。回傳 spaceId 與可見度。",
      {
        name: z.string().trim().min(1).max(SPACE_NAME_MAX_CHARS).describe("空間名稱"),
        description: z
          .string()
          .trim()
          .max(SPACE_DESCRIPTION_MAX_CHARS)
          .optional()
          .describe("空間描述（選填）"),
        visibility: z
          .enum(["private", "org_read", "org_write"])
          .optional()
          .describe(
            "可見度（省略＝private）：private＝僅成員可見；org_read＝全組織可讀；org_write＝全組織可讀寫",
          ),
      },
      async ({ name, description, visibility }, extra) => {
        const gate = writeGate(extra);
        if (!gate.ok) return gate.result;
        const space = await apiCreateSpace(actorFrom(extra), { name, description, visibility });
        return {
          content: [
            {
              type: "text" as const,
              text: `已建立空間「${space.name}」\nspaceId: ${space.id}\nslug: ${space.slug}\n可見度: ${space.visibility}`,
            },
          ],
        };
      },
    );

    server.tool(
      "update_space",
      "更新既有空間的設定：name（改名）、description（改描述，傳 null 清除）、icon（傳 null 清除）、visibility（可見度）——至少提供一項。spaceId 取自 list_spaces／search_pages／read_page。需空間管理員權限與 write scope 的 token。",
      {
        spaceId: z.string().uuid().describe("目標空間 id（UUID）"),
        name: z
          .string()
          .trim()
          .min(1)
          .max(SPACE_NAME_MAX_CHARS)
          .optional()
          .describe("新名稱；省略＝不變"),
        description: z
          .string()
          .trim()
          .max(SPACE_DESCRIPTION_MAX_CHARS)
          .nullable()
          .optional()
          .describe("新描述；null＝清除；省略＝不變"),
        icon: z
          .string()
          .trim()
          .max(16)
          .nullable()
          .optional()
          .describe("新 emoji 圖示；null＝清除；省略＝不變"),
        visibility: z
          .enum(["private", "org_read", "org_write"])
          .optional()
          .describe("可見度：private／org_read／org_write；省略＝不變"),
      },
      async ({ spaceId, name, description, icon, visibility }, extra) => {
        const gate = writeGate(extra);
        if (!gate.ok) return gate.result;
        if (
          name === undefined &&
          description === undefined &&
          icon === undefined &&
          visibility === undefined
        ) {
          return mcpError("name／description／icon／visibility 至少需提供一項。");
        }
        const outcome = await apiUpdateSpace(actorFrom(extra), {
          spaceId,
          name,
          description,
          icon,
          visibility,
        });
        if (!outcome.ok) return mcpError("空間不存在或無管理權限。");
        const s = outcome.space;
        return {
          content: [
            {
              type: "text" as const,
              text: `已更新空間「${s.name}」\nspaceId: ${s.id}\nslug: ${s.slug}\n可見度: ${s.visibility}`,
            },
          ],
        };
      },
    );

    server.tool(
      "set_space_member",
      "設定、變更或移除空間成員（以 email 指定使用者）。role＝admin／editor／commenter／viewer 加入或變更角色；role＝none 移除成員。spaceId 取自 list_spaces／search_pages／read_page。需空間管理員權限與 write scope 的 token。不可移除或降級空間最後一位管理員。",
      {
        spaceId: z.string().uuid().describe("目標空間 id（UUID）"),
        email: z.string().trim().min(1).describe("使用者 email（需與系統中的帳號相符）"),
        role: z
          .enum(["admin", "editor", "commenter", "viewer", "none"])
          .describe(
            "角色：admin（管理）／editor（編輯）／commenter（評論）／viewer（唯讀）；none＝移除該成員",
          ),
      },
      async ({ spaceId, email, role }, extra) => {
        const gate = writeGate(extra);
        if (!gate.ok) return gate.result;
        const outcome = await apiSetSpaceMember(actorFrom(extra), {
          spaceId,
          email,
          role: role === "none" ? null : role,
        });
        if (!outcome.ok) {
          if (outcome.error === "USER_NOT_FOUND")
            return mcpError(`找不到 email 為 ${email} 的使用者（需為系統中的啟用帳號）。`);
          if (outcome.error === "LAST_ADMIN")
            return mcpError("不可移除或降級空間的最後一位管理員。");
          return mcpError("空間不存在或無管理權限。");
        }
        const text =
          outcome.role === null
            ? `已將 ${outcome.email} 移出空間。`
            : `已設定 ${outcome.email} 的角色為 ${outcome.role}。`;
        return { content: [{ type: "text" as const, text }] };
      },
    );

    server.tool(
      "move_page",
      "搬移頁面。同空間換父層：給 newParentId（null＝根層，接該層末尾）；跨空間：給 targetSpaceId（整支子樹搬移、附件歸屬同步轉移，掛目標空間根層）。兩者擇一。需要 write scope 的 token。",
      {
        pageId: z.string().uuid().describe("要搬移的頁面 id（UUID）"),
        targetSpaceId: z
          .string()
          .uuid()
          .optional()
          .describe("目的地空間 id（跨空間搬移；取自 list_spaces／search_pages／read_page）"),
        newParentId: z
          .string()
          .uuid()
          .nullable()
          .optional()
          .describe("同空間搬移的新父頁面 id；null＝移到根層"),
      },
      async ({ pageId, targetSpaceId, newParentId }, extra) => {
        const gate = writeGate(extra);
        if (!gate.ok) return gate.result;
        const outcome = await apiMovePage(actorFrom(extra), { pageId, targetSpaceId, newParentId });
        if (!outcome.ok) {
          if (outcome.error === "CYCLE") return mcpError("不可搬移到自己或自己的子頁面之下。");
          if (outcome.error === "INVALID") return mcpError(outcome.message);
          return mcpError("頁面/目標空間不存在或無權寫入。");
        }
        const p = outcome.page;
        return {
          content: [
            {
              type: "text" as const,
              text: `已搬移（受影響 ${outcome.movedCount} 頁）\n路徑: /s/${p.spaceSlug}/${p.slug}\n父層: ${p.parentId ?? "（根層）"}`,
            },
          ],
        };
      },
    );

    server.tool(
      "delete_page",
      "【破壞性操作】刪除頁面（軟刪除進回收桶，30 天內可還原）。有子頁面時需 recursive=true 才會連同整支子樹刪除。執行前務必先向使用者確認要刪的是哪一頁；除非使用者明確要求連子頁一起刪，否則不要帶 recursive。需要 write scope 的 token。",
      {
        pageId: z.string().uuid().describe("要刪除的頁面 id（UUID）"),
        recursive: z
          .boolean()
          .optional()
          .describe("true＝連同全部子頁面一併刪除（預設 false：有子頁即拒絕）"),
      },
      async ({ pageId, recursive }, extra) => {
        const gate = writeGate(extra);
        if (!gate.ok) return gate.result;
        const outcome = await apiDeletePage(actorFrom(extra), { pageId, recursive });
        if (!outcome.ok) {
          if (outcome.error === "HAS_CHILDREN") {
            return mcpError(
              `頁面有 ${outcome.childCount} 個子頁面，未執行刪除。若確定要連同子樹刪除，請與使用者確認後帶 recursive=true 重試。`,
            );
          }
          return mcpError("頁面不存在或無權寫入。");
        }
        return {
          content: [
            {
              type: "text" as const,
              text: `已軟刪除 ${outcome.deletedPageIds.length} 頁（回收桶保留 30 天，可由空間編輯者還原）。`,
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
            : rows
                .map(
                  (s) =>
                    `- ${s.name}（slug: ${s.slug}）${s.description ? ` — ${s.description}` : ""}\n  spaceId: ${s.id}`,
                )
                .join("\n");
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
