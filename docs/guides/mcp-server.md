# JetBook MCP Server 使用指南（M4-07，F-API-04）

JetBook 內建 MCP（Model Context Protocol）Server，讓 Claude 等 AI 助理直接搜尋與閱讀知識庫。

- **端點**：`https://<你的 JetBook 網域>/api/mcp`（streamable HTTP）
- **認證**：HTTP Bearer——個人 API token（JetBook「個人設定 → API Token」建立，`jbk_` 開頭）
- **工具**：`search_pages`（全文搜尋）、`read_page`（讀取頁面 Markdown）、`list_spaces`（列出可存取空間）

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
