# JetBook MCP Server 使用指南（M4-07，F-API-04）

JetBook 內建 MCP（Model Context Protocol）Server，讓 Claude 等 AI 助理直接搜尋與閱讀知識庫。

- **端點**：`https://<你的 JetBook 網域>/api/mcp`（streamable HTTP）
- **認證**：HTTP Bearer——個人 API token（JetBook「個人設定 → API Token」建立，`jbk_` 開頭）
- **唯讀工具**：`search_pages`（全文搜尋）、`read_page`（讀取頁面 Markdown）、`list_spaces`（列出可存取空間）
- **寫入工具**（需建立時勾選「允許寫入」的 token）：`create_page`（建立頁面）、`update_page`（部分更新：markdown 全量取代內容／title 改名，至少提供一項；`expectedVersion` 選填做樂觀鎖）、`create_space`（建立空間；slug 自動產生，建立者自動成為該空間管理員；`visibility` 選填 private／org_read／org_write，省略＝private）、`update_space`（更新空間 name／description／icon／visibility，需空間管理員）、`set_space_member`（以 email 加入／變更／移除空間成員角色 admin／editor／commenter／viewer／none，需空間管理員；不可移除最後一位管理員）、`move_page`（同空間換父層或跨空間搬移整支子樹；循環防護、附件歸屬同步轉移）、`delete_page`（**破壞性**：軟刪除進回收桶 30 天可還原；有子頁需明確帶 `recursive=true`，AI 助理應先向使用者確認）、`import_attachment_from_url`（伺服器端下載外部圖片存為永久附件並綁定頁面，回傳可內嵌的內部 Markdown；見下方）。寫入經標準儲存管線：自動版本快照（可還原）、嵌入索引；他人編輯中（軟性鎖）會被拒絕。
- **唯讀工具**補充：`list_spaces`／`search_pages`／`read_page` 皆回傳 `spaceId`，可直接餵給 `create_page`／`update_space`／`move_page`／`set_space_member`，無需額外查詢。

## 匯入外部圖片為永久附件（`import_attachment_from_url`）

頁面 Markdown 內的**外部圖片連結**（如 Redmine 附件 URL）閱讀端不會內嵌顯示——JetBook 僅渲染同源上傳的附件（`/api/files/<id>`）。要把外部圖片變成永久內嵌圖片，用 `import_attachment_from_url` 逐張匯入，再以回傳的內部 Markdown 用 `update_page` 替換原本的外部圖片語法。

- **輸入**：`pageId`（綁定的頁面，需寫入權限）、`sourceUrl`（http/https）、`filename?`、`altText?`、`expectedContentType?`。
- **回傳**：`attachmentId`、內部 `url`（`/api/files/<id>`）、可直接貼入頁面的 `markdown`（`![alt](/api/files/<id>)`）、`contentType`、`size`。
- **行為**：伺服器端下載 → 驗證真實內容（magic bytes，僅 JPEG／PNG／GIF／WebP）→ 存入既有附件系統並綁定頁面。大型檔案全程在伺服器端串流，不經模型（無 base64）。
- **只認內部圖片 URL 才會內嵌**：`create_page`／`update_page` 的 Markdown 中，只有 `/api/files/<uuid>` 形態的圖片會產生內嵌圖片節點並於 `read_page` 完整往返；純外部圖片 URL 仍會降級為連結（請先經本工具轉為永久附件）。

### 來源白名單（SSRF 防護，管理者設定）

伺服器端匯入預設**拒絕所有來源**；管理者須以環境變數開放允許的來源網域：

```
JETBOOK_ATTACHMENT_IMPORT_HOSTS=redmine.jet-opto.com.tw,192.168.162.158
```

- 只允許 http/https；host 須精確落在白名單內（不做子網域展開）。
- 列入白名單的來源可解析到私有網段（內網 Redmine 即此情境）；但 loopback、link-local（含 cloud metadata `169.254.169.254`）、multicast 等一律硬性封鎖，白名單不放行。
- 每次 redirect 逐跳重驗協定／host／IP；限制 redirect 次數、連線逾時與最大檔案大小。

### 需登入的 Redmine 圖片

`import_attachment_from_url` **不接受任意 Authorization header**。若來源需登入，請用 **Redmine MCP** 產生短效下載 URL（`redmine_attachments_get` 回傳的 `download_url`，數分鐘失效），再把該短效 URL 傳給本工具；並將其 host 納入 `JETBOOK_ATTACHMENT_IMPORT_HOSTS`。

## 安全鐵律

**每位使用者必須使用自己的 token。** 工具結果的可見範圍完全等於 token 擁有者在 JetBook 的權限；
若整個團隊共用一把（尤其 admin 的）token，私有空間內容將經由 AI 助理外洩給無權者。
token 撤銷（個人設定）後 MCP 呼叫立即失效。

## Claude Code

```bash
claude mcp add --transport http jetbook https://<網域>/api/mcp \
  --header "Authorization: Bearer jbk_xxxxxxxx"
```

## Claude Desktop（Settings → Connectors → Add custom connector）

或在 `claude_desktop_config.json` 以 `mcp-remote` 橋接：

```json
{
  "mcpServers": {
    "jetbook": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote", "https://<網域>/api/mcp",
        "--header", "Authorization: Bearer jbk_xxxxxxxx"
      ]
    }
  }
}
```

> **內網純 HTTP 部署**：`mcp-remote` 對非 localhost 的 `http://` URL 會直接拒絕
> （`Non-HTTPS URLs are only allowed for localhost`）。在 args 加 `--allow-http` 即可：
>
> ```json
> "args": [
>   "-y", "mcp-remote", "http://<內網位址>/api/mcp",
>   "--allow-http",
>   "--header", "Authorization: Bearer jbk_xxxxxxxx"
> ]
> ```
>
> token 在純 HTTP 下是明文傳輸，僅限受信任內網；正式環境建議依 README「部署與維運」掛內部 CA 憑證走 HTTPS。

## 疑難排解

| 症狀 | 原因 |
|---|---|
| 401 | token 缺少、打錯、已撤銷、已過期，或帳號被停用 |
| 找不到預期頁面 | token 擁有者對該空間無讀取權（權限即 UI 權限） |
| SSE 連線失敗 | 本部署僅支援 streamable HTTP（`/api/mcp`），不支援舊式 SSE |
| `Non-HTTPS URLs are only allowed for localhost` 後斷線 | `mcp-remote` 拒絕非 localhost 的 `http://`；內網純 HTTP 部署需加 `--allow-http`（見上方） |
