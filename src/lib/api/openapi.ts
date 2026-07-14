/**
 * REST API v1 的 OpenAPI 3.1 規格（M4-06，F-API-01 驗收 2；M4-09 寫入端點）。
 * 單一事實來源：/api/v1/openapi.json 與 /api-docs 文件頁皆由此渲染。
 * 認證一律 Bearer API token（個人設定建立）；寫入端點需 write scope 的 token。
 */
export const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "JetBook REST API",
    version: "1.2.0",
    description:
      "JetBook 知識庫 API。認證：HTTP Bearer（個人 API token，於個人設定建立；權限與該使用者 UI 權限一致）。讀取需 read scope；寫入端點需建立時勾選「允許寫入」的 token（write scope）。限流：120 次/分/token。",
  },
  security: [{ bearerAuth: [] }],
  paths: {
    "/api/v1/spaces": {
      get: {
        summary: "列出可存取的空間",
        description: "回傳呼叫者有權讀取的全部空間。",
        responses: {
          "200": { description: "空間清單（id、slug、name、description、icon、visibility）" },
          "401": { description: "token 缺少、無效、已撤銷或已過期" },
        },
      },
      post: {
        summary: "建立空間（M4-13，需 write scope）",
        description:
          "建立新的知識空間；slug 由系統自動產生（重名自動加尾碼），建立者自動成為該空間管理員。",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: {
                  name: { type: "string", maxLength: 100 },
                  description: { type: "string", maxLength: 500 },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "已建立（id、slug、name）" },
          "400": { description: "body 格式錯誤" },
          "403": { description: "token 無 write scope" },
        },
      },
    },
    "/api/v1/spaces/{slug}/pages": {
      get: {
        summary: "列出空間的頁面樹",
        parameters: [
          { name: "slug", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description:
              "頁面節點清單（id、parentId、slug、title、icon、kind、position；僅含呼叫者可讀節點）",
          },
          "404": { description: "空間不存在或無權存取" },
        },
      },
      post: {
        summary: "建立頁面（M4-09，需 write scope）",
        description: "在空間內建立新頁面並寫入 Markdown 內容；經標準儲存管線（版本快照、嵌入索引）。",
        parameters: [
          { name: "slug", in: "path", required: true, schema: { type: "string" } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["title", "markdown"],
                properties: {
                  title: { type: "string", maxLength: 200 },
                  markdown: { type: "string", description: "頁面內容（Markdown）" },
                  parentId: { type: "string", format: "uuid", description: "父頁面 id；省略＝根層" },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "已建立（id、slug、title、spaceSlug、versionNo）" },
          "400": { description: "body 格式錯誤" },
          "403": { description: "token 無 write scope" },
          "404": { description: "空間/父節點不存在或無權存取" },
        },
      },
    },
    "/api/v1/pages/{id}": {
      get: {
        summary: "讀取單一頁面",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": {
            description: "頁面內容（id、title、icon、slug、spaceSlug、contentMd、updatedAt、versionNo）",
          },
          "404": { description: "頁面不存在或無權存取" },
        },
      },
      patch: {
        summary: "部分更新頁面（M4-09/M4-13，需 write scope）",
        description:
          "markdown（全量取代內容，經標準儲存管線：版本快照可還原、嵌入索引）與 title（改名，slug 重算＋舊網址 301）至少提供一項。expectedVersion 選填做樂觀鎖，不符回 409 CONFLICT（含 currentVersion）。他人編輯中（軟性鎖）回 409 LOCKED。",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                anyOf: [{ required: ["markdown"] }, { required: ["title"] }],
                properties: {
                  markdown: {
                    type: "string",
                    description: "新的頁面內容（Markdown，全量取代）；省略＝僅改標題",
                  },
                  title: { type: "string", maxLength: 200, description: "新標題；省略＝不變" },
                  expectedVersion: {
                    type: "integer",
                    minimum: 0,
                    description: "樂觀鎖：呼叫端已知的版本號，不符時拒絕",
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "已更新（id、slug、title、spaceSlug、versionNo）" },
          "400": { description: "body 格式錯誤（markdown 與 title 至少需一項）" },
          "403": { description: "token 無 write scope" },
          "404": { description: "頁面不存在或無權存取" },
          "409": { description: "LOCKED（他人編輯中）或 CONFLICT（版本不符/並發寫入，含 currentVersion）" },
        },
      },
    },
    "/api/v1/search": {
      get: {
        summary: "全文搜尋",
        parameters: [
          { name: "q", in: "query", required: true, schema: { type: "string" } },
          {
            name: "limit",
            in: "query",
            required: false,
            schema: { type: "integer", minimum: 1, maximum: 50, default: 20 },
          },
        ],
        responses: {
          "200": {
            description: "搜尋結果（pageId、title、icon、slug、spaceSlug、spaceName、snippet、score；僅含可讀內容）",
          },
          "401": { description: "token 缺少、無效、已撤銷或已過期" },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", description: "個人 API token（jbk_ 開頭）" },
    },
  },
} as const;
