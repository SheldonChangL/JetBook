# JetBook MCP Server 使用指南

把 JetBook 知識庫接上 Claude，讓它直接**搜尋、閱讀、撰寫**你有權限看到的頁面——不必再複製貼上。

> **一般使用者請直接看站內「使用說明」頁（`<網域>/guide#mcp`）**——那裡的設定片段會自動填好本站網域，
> 建立 token 完成的畫面更會直接給出含 token、複製即可用的設定。本檔是完整參考（工具清單、SSRF 白名單、排錯）。

接好之後你可以直接在 Claude 裡這樣說：

- 「查一下 JetBook 有沒有寫過 XX 機台的校正流程。」
- 「把這次的討論整理成一頁，建到『設備維護』空間底下。」
- 「這頁的第 3 節過期了，依我剛給的資料改寫。」

> **看得到什麼，完全等於你在 JetBook 網頁上看得到什麼**。MCP 不會放大權限。

---

## 一、開始之前

| 需要 | 怎麼取得 |
|---|---|
| JetBook 網域 | 例如 `https://jetbook.jet-opto.com.tw`（問管理者） |
| 個人 API token | 下面步驟 1 自己建，`jbk_` 開頭 |
| 客戶端 | Claude Code（CLI，三平台通用）或 Claude Desktop（**僅 macOS／Windows**，Linux 無官方版） |
| Node 18+ | 只有走 Claude Desktop 設定檔（`mcp-remote` 橋接）才需要；Claude Code 與內建連接器都不需要 |

技術規格（不需要記，排錯時才用）：端點 `<網域>/api/mcp`、傳輸 streamable HTTP、認證 HTTP Bearer。

---

## 二、三步接上

### 步驟 1 — 建立你自己的 API token

1. 登入 JetBook → 右上頭像 → **個人設定**（`/settings`）
2. 找到 **API Token** 區塊 → 按 **建立 Token**
3. 填名稱（用途，例：`claude-desktop-我的筆電`）、選有效期限
4. **要讓 Claude 幫你寫頁面**才勾「允許寫入」；只要查資料就別勾（預設唯讀最安全）
5. 按建立後 **立刻複製**——token 只顯示這一次，關掉就再也看不到

> 忘了複製或懷疑外流：撤銷舊的、重建一把即可，撤銷後立即失效。

### 步驟 2 — 把 JetBook 加進客戶端

先挑路徑。**能用哪一條取決於作業系統與 JetBook 是 HTTPS 還是純 HTTP**：

| 你的環境 | 用哪條 |
|---|---|
| 任何平台，習慣終端機 | Claude Code（下方 A，最少變數） |
| macOS／Windows + HTTPS 部署 | Claude Desktop 內建連接器（下方 B，免裝 Node） |
| macOS／Windows + 純 HTTP 部署 | Claude Desktop 設定檔（下方 C／D，必須帶 `--allow-http`） |
| Linux 桌面 | 只有 Claude Code——**沒有官方 Claude Desktop for Linux** |

#### A. Claude Code（三平台通用）

```bash
claude mcp add --transport http jetbook https://<網域>/api/mcp \
  --header "Authorization: Bearer jbk_xxxxxxxx"
```

驗證：`claude mcp list` 應列出 `jetbook`。純 HTTP 部署把網址換成 `http://<內網位址>/api/mcp` 即可——Claude Code 自己連 HTTP 端點，不經 `mcp-remote`，所以**不需要** `--allow-http`。

#### B. Claude Desktop 內建連接器（僅 HTTPS 可用，推薦）

Settings → Connectors → **Add custom connector** → 填入 `https://<網域>/api/mcp`，並加一個 header：名稱 `Authorization`、值 `Bearer jbk_xxxxxxxx`。

不需要 Node、不經 `mcp-remote`，因此完全沒有下面那些路徑與引號問題。**自訂連接器要求 HTTPS**，純 HTTP 部署走不了這條。

#### C. Claude Desktop 設定檔 — macOS

設定檔：`~/Library/Application Support/Claude/claude_desktop_config.json`

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

存檔後按 **⌘Q 完全結束** Claude Desktop 再開（關視窗不會重啟 MCP 伺服器）。

> 從 Dock／Finder 啟動的 GUI app **不繼承終端機的 PATH**。node 是用 Homebrew 或 nvm 裝的話，`npx` 可能找不到（log 出現 `spawn npx ENOENT`）→ 把 `command` 換成絕對路徑，例如 `/opt/homebrew/bin/npx`（Apple Silicon Homebrew）或 `which npx` 印出的值。

#### D. Claude Desktop 設定檔 — Windows

設定檔：`%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "jetbook": {
      "command": "cmd",
      "args": [
        "/c", "npx",
        "-y", "mcp-remote", "https://<網域>/api/mcp",
        "--header", "Authorization: Bearer jbk_xxxxxxxx"
      ]
    }
  }
}
```

**Windows 一定要寫成 `cmd` + `/c` + `npx`，不能直接 `"command": "npx"`。** Claude Desktop 會把 `command` 解析成絕對路徑後包進 `cmd.exe /c` 且不加引號；node 預設裝在 `C:\Program Files\nodejs`，cmd 只吃到 `C:\Program` 就當成指令名，伺服器啟動即失敗（見〈疑難排解〉的 Windows 段）。寫成 `cmd /c npx` 是讓 cmd 自己去 PATH 找 npx，`args` 陣列各元素獨立傳遞，不會被空白切斷。

存檔後**從系統匣「結束」**Claude Desktop 再開（按右上 ✕ 只是關視窗）。

#### 如果 JetBook 是內網純 HTTP（網址開頭 `http://`）

`mcp-remote` 會直接拒絕非 localhost 的 `http://`（`Non-HTTPS URLs are only allowed for localhost`）。**C／D 都要在 args 加 `--allow-http`**，位置放在網址之後：

```json
"args": [
  "/c", "npx",
  "-y", "mcp-remote", "http://<內網位址>/api/mcp",
  "--allow-http",
  "--header", "Authorization: Bearer jbk_xxxxxxxx"
]
```

（上例為 Windows；macOS 拿掉 `"/c", "npx"` 並把 `command` 改回 `npx`。）

純 HTTP 下 token 是明文傳輸，僅限受信任內網使用。正式環境請依 README「部署與維運」掛內部 CA 憑證改走 HTTPS。

> 站內 `<網域>/guide#mcp` 會直接產生**已填好本站網域、並依部署自動補上 `--allow-http`** 的 macOS 與 Windows 兩份設定，比照抄本檔更不容易出錯。

### 步驟 3 — 驗證接上了

在 Claude 裡輸入：

> 用 JetBook 列出我可以存取的空間。

看到空間清單就成功了。列不出來、或跳 401 → 見最後的〈疑難排解〉。

---

## 三、可用工具速查

Claude 會自己挑工具，你只要用中文描述需求。這張表是排錯與確認能力範圍時看的。

### 唯讀（任何 token 都能用）

| 工具 | 做什麼 |
|---|---|
| `list_spaces` | 列出你可存取的空間（含 `spaceId`） |
| `search_pages` | 全文搜尋（支援中文），回傳標題／片段／`pageId`／`spaceId` |
| `read_page` | 讀取單頁完整 Markdown，附版本號與 `spaceId` |

> 三者的回傳都帶 `spaceId`／`pageId`，可直接餵給下方寫入工具，不需要額外查一次。

### 寫入（token 必須勾「允許寫入」）

| 工具 | 做什麼 | 必填 | 要注意 |
|---|---|---|---|
| `create_page` | 在空間裡建新頁 | `spaceId`、`title`、`markdown` | `parentId` 省略＝建在根層 |
| `update_page` | 改內容或改標題 | `pageId` ＋ `markdown`／`title` 至少一項 | `markdown` 是**全量取代**；`expectedVersion` 選填做樂觀鎖 |
| `move_page` | 換父層或跨空間搬移 | `pageId` ＋ `newParentId`／`targetSpaceId` 擇一 | 跨空間會整支子樹搬走，附件歸屬同步轉移；有循環防護 |
| `delete_page` | **破壞性**：刪頁 | `pageId` | 軟刪除進回收桶（30 天可還原）；有子頁需明確帶 `recursive=true` |
| `create_space` | 建新空間 | `name` | slug 自動產生；建立者自動成為該空間管理員；`visibility` 省略＝private |
| `update_space` | 改空間 name／description／icon／visibility | `spaceId` ＋ 至少一項 | 需空間管理員 |
| `set_space_member` | 以 email 加人／改角色／移除 | `spaceId`、`email`、`role` | `role=none` 為移除；不可移除最後一位管理員 |
| `import_attachment_from_url` | 外部圖片轉成永久附件 | `pageId`、`sourceUrl` | 需管理者開白名單；見第五節 |

**可見度（visibility）三選一**：`private`＝僅成員可見；`org_read`＝全組織可讀；`org_write`＝全組織可讀寫。
**空間角色（role）**：`admin`（管理）／`editor`（編輯）／`commenter`（評論）／`viewer`（唯讀）／`none`（移除）。

寫入一律走 JetBook 唯一儲存管線，因此和網頁編輯完全一致：**自動版本快照可還原**、自動重建搜尋與 AI 索引、**他人正在編輯（軟性鎖）時會被拒絕**、全部進稽核日誌。

---

## 四、安全鐵律：token 就是你的身分

**每個人都必須用自己的 token。**

工具結果的可見範圍完全等於 token 擁有者的權限。若全團隊共用一把（尤其管理者那把），私有空間的內容就會經由 AI 助理外洩給無權者——JetBook 這端看到的是「token 擁有者本人在存取」，攔不下來。

- 一把 token 對應一個人、一個客戶端；不要貼進共用文件或群組聊天室。
- 不需要 Claude 幫你寫東西時，維持唯讀 token。
- 離職、換機、疑似外流：到個人設定按撤銷，MCP 呼叫立即失效。

---

## 五、進階：把外部圖片變成永久附件

**問題**：頁面 Markdown 裡的**外部圖片連結**（例如 Redmine 的附件 URL）在 JetBook 閱讀端不會顯示成圖片——只有同源上傳的附件（`/api/files/<id>`）才會內嵌渲染。

**做法**：用 `import_attachment_from_url` 逐張匯入，取得回傳的內部 Markdown，再用 `update_page` 把原本的外部圖片語法換掉。

- **輸入**：`pageId`（要綁定的頁面，需寫入權限）、`sourceUrl`（http/https）、`filename?`、`altText?`、`expectedContentType?`
- **回傳**：`attachmentId`、內部 `url`（`/api/files/<id>`）、可直接貼入頁面的 `markdown`、`contentType`、`size`
- **行為**：伺服器端下載 → 驗證真實內容（magic bytes，僅 JPEG／PNG／GIF／WebP）→ 存進既有附件系統並綁定該頁。大檔全程在伺服器端串流，不經模型（不做 base64）。

### 來源白名單（SSRF 防護，管理者設定）

伺服器端匯入**預設拒絕所有來源**，管理者須以環境變數逐一開放：

```
JETBOOK_ATTACHMENT_IMPORT_HOSTS=redmine.example.com,10.0.0.10
```

- 只允許 http/https；host 須精確落在白名單內（不做子網域展開）。
- 白名單來源可以解析到私有網段（內網 Redmine 即此情境）；但 loopback、link-local（含 cloud metadata `169.254.169.254`）、multicast 一律硬性封鎖，白名單也不放行。
- 每次 redirect 逐跳重驗協定／host／IP；限制 redirect 次數、連線逾時與最大檔案大小。

### 來源需要登入時（例：Redmine 私有附件）

`import_attachment_from_url` **不接受任意 Authorization header**。請改用來源系統產生的**短效下載 URL**：以 Redmine MCP 的 `redmine_attachments_get` 取得 `download_url`（數分鐘後失效），把該 URL 傳給本工具，並確認其 host 已列入 `JETBOOK_ATTACHMENT_IMPORT_HOSTS`。

---

## 六、疑難排解

**先分辨是哪一層壞掉**——這決定你要看哪一節：

- Claude 裡**完全看不到 JetBook 工具**、或連上就斷線 → MCP 伺服器沒啟動起來，看〈6.1 啟動失敗〉。
- 工具**看得到、叫得動，但回錯誤**（401、找不到頁面、被拒寫入）→ 看〈6.2 連上了但被拒〉。

### 6.1 啟動失敗（分平台）

先看 log，症狀一目瞭然：

| 平台 | log 位置 |
|---|---|
| macOS | `~/Library/Logs/Claude/mcp-server-jetbook.log`（另有 `mcp.log` 記啟動流程） |
| Windows | `%APPDATA%\Claude\logs\mcp-server-jetbook.log` |
| Claude Code（任何平台） | `claude mcp list` 看連線狀態；`/mcp` 於互動 session 內查看 |

**通用第一步：在終端機手動跑一次橋接程式。** 跑不起來就是 Node 環境問題，與 JetBook 無關：

```bash
npx -y mcp-remote --version
```

Windows 請在 cmd 執行 `cmd /c npx -y mcp-remote --version`。`mcp-remote` 需要 Node 18 以上。

| 症狀（log 內容） | 平台 | 原因與處置 |
|---|---|---|
| `'C:\Program' 不是內部或外部命令、可執行的程式或批次檔`（英文版：`'C:\Program' is not recognized...`），緊接 `Server transport closed unexpectedly` | Windows | `"command": "npx"` 被解析成 `C:\Program Files\nodejs\...` 後未加引號地包進 `cmd.exe /c` → 改用步驟 2-D 的 `cmd` + `/c` + `npx` 寫法。仍失敗則把 `command` 換成 8.3 短路徑 `C:\PROGRA~1\nodejs\npx.cmd` |
| `spawn npx ENOENT` | macOS | GUI app 不繼承終端機 PATH，找不到 Homebrew／nvm 裝的 node → `command` 改成 `which npx` 印出的絕對路徑 |
| `npx: command not found` | Linux | Node 未安裝或不在 PATH；Linux 建議直接用 Claude Code（步驟 2-A），不需要 Node |
| `Non-HTTPS URLs are only allowed for localhost` | 全部 | `mcp-remote` 拒絕非 localhost 的 `http://` → args 加 `--allow-http`（步驟 2） |
| 改了設定檔卻毫無變化 | macOS／Windows | 設定檔沒重讀。macOS 按 ⌘Q、Windows 從系統匣「結束」，關視窗不算。也確認改的是對的檔案（macOS `~/Library/Application Support/Claude/`、Windows `%APPDATA%\Claude\`） |
| 設定檔存了但 app 完全不理 | 全部 | JSON 語法錯（多餘逗號、中文全角引號、路徑反斜線未轉義成 `\\`）→ 用 JSON 檢查工具驗過再存 |
| Linux 找不到 Claude Desktop 設定檔 | Linux | 沒有官方 Claude Desktop for Linux → 用 Claude Code（步驟 2-A） |

### 6.2 連上了但被拒

| 症狀 | 原因與處置 |
|---|---|
| `401` | token 缺少、打錯（含少了 `Bearer ` 前綴或那個空格）、已撤銷、已過期，或帳號被停用 → 重建 token |
| 「找不到預期的頁面」 | token 擁有者對該空間沒有讀取權（權限＝UI 權限）→ 請空間管理員加你為成員 |
| 「需要寫入權限」類錯誤 | token 沒勾「允許寫入」→ 重建一把勾選寫入的 token（既有 token 無法補加） |
| 「頁面正由 ⋯ 編輯中」 | 對方持有軟性編輯鎖 → 等閒置釋放（5 分鐘）或請對方離開編輯器 |
| 「版本不符」 | 有人先改過（樂觀鎖擋下覆蓋）→ 重新 `read_page` 取最新內容後再寫 |
| `429` / 「請求過於頻繁」 | 單一 token 上限 120 次／分鐘 → 依 `retry-after` 秒數後重試 |
| SSE 連線失敗 | 本部署僅支援 streamable HTTP（`/api/mcp`），不支援舊式 SSE |

---

規格對應：F-API-04（MCP Server）、M4-07／M4-09／M4-13。實作在 [`src/app/api/mcp/route.ts`](../../src/app/api/mcp/route.ts)。
