/**
 * REST API v1 的 OpenAPI 3.1 規格（M4-06，F-API-01 驗收 2）。
 * 單一事實來源：/api/v1/openapi.json 與 /api-docs 文件頁皆由此渲染。
 * v1 全為唯讀端點；認證一律 Bearer API token（個人設定建立）。
 */
export const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "JetBook REST API",
    version: "1.0.0",
    description:
      "JetBook 知識庫唯讀 API。認證：HTTP Bearer（個人 API token，於個人設定建立；權限與該使用者 UI 權限一致）。限流：120 次/分/token。",
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
