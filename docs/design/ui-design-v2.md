# JetBook UI Design v2 — Archive Studio／知識工坊

> 狀態：已選定；六個順序 issue／PR（#251–#262）均已完成。#263 依實際使用回饋再改善編輯工作區的人因與工具可發現性；#269 將 App Shell 由雙側欄改為展開單一 sidebar／收合 compact rail；#271 移除 Legacy presentation layer 與 rollout 機制，Archive 成為唯一 UI。原始兩案與 16 張 mock 見 `docs/design/mockups-v2/`。

## 1. 設計方向

### Visual thesis

JetBook 是工程師使用的活文件檔案室：以紙張、索引、檔案標籤與工作檯建立品牌辨識，讓知識本身成為畫面主角，而不是套用通用 SaaS 卡片外觀。

### Content plan

1. 展開狀態使用 288 px 單一 Archive Sidebar：品牌、首頁、所有空間、搜尋、AI、個人設定與 Space Dock 共用同一個 surface，避免深色 rail 與淺色 dock 並排造成雙 bar。
2. 收合狀態保留 72 px compact rail，維持首頁、所有空間、搜尋、AI 與設定入口。
3. 中央 Canvas 保留原路由內容與操作，逐批改造成閱讀／編輯工作檯。
4. Inspector 只在任務需要時顯示 TOC、留言、編輯鎖、版本或 AI，不永久壓縮內容。

### Interaction thesis

- 桌面展開時 Rail 與 Space Dock 整合為單一 sidebar；收合時只保留 compact rail；行動版改用具 focus trap／restore 的 Drawer。
- 閱讀進入編輯後切換為 focus mode，暫時收起頁面樹；返回閱讀時立即恢復原導航脈絡。
- Cmd+K 與 AI 共用探索工作層；來源、引用、附件預覽與錯誤保持在同一脈絡。
- 動效只使用短距離 opacity／translate；`prefers-reduced-motion: reduce` 下停用。

## 2. 不變合約

UI v2 只替換 presentation layer。以下合約在六批遷移期間均不得改變：

- URL 與 App Router 路由。
- Server Action、REST、MCP 與 SSE 介面。
- PostgreSQL schema、資料規則與內容儲存管線。
- session、authz、Space 權限與 RAG SQL 權限隔離。
- `light | dark | system` 主題格式與 `jetbook-theme` 偏好。
- 現有功能、失敗狀態、繁中 i18n 與鍵盤路徑。

## 3. rollout（已完成並移除）

遷移期間 Archive Studio 曾以 Strangler pattern 與 Legacy 並存：`UI_V2_ROLLOUT=off|opt-in|on` 為全域開關、HttpOnly cookie `jetbook-ui-version` 記錄使用者偏好、SSR 寫入 `html[data-ui-version]` 決定 presentation。

六批功能矩陣完成且 Archive 確認為功能超集後，**#271 已徹底移除 Legacy 與整套 rollout 機制**：`UI_V2_ROLLOUT` env、`jetbook-ui-version` cookie、`data-ui-version` 屬性、`ui-archive-only`／`ui-legacy-only` DOM markers 與 Legacy 元件皆不存在，Archive 為唯一且不可切換的 UI。此舉同時放棄 env-based 即時回退舊 UI 的 kill switch（取捨已於 issue 確認接受；回退手段為部署上一版 image）。

## 4. 語意 token

Archive token 即全站 token：直接定義於 `:root`（light）與 `html.dark`（dark），程式碼語法高亮 `--code-*` 沿用既有 GitHub light/dark 配色。元件一律使用 `bg-base`、`text-fg`、`border-edge` 等語意 utility，不得直接寫色值。

### 核心色彩

| Token | Light | Dark | 用途 |
| --- | --- | --- | --- |
| `--bg-base` | `#EFECE4` | `#171714` | Canvas／主工作檯 |
| `--bg-sidebar` | `#F8F5ED` | `#1E1F1B` | Archive Sidebar／Space Dock／次層表面 |
| `--bg-raised` | `#FFFDF7` | `#272720` | Topbar／Dialog／需要抬升的表面 |
| `--text-primary` | `#282A26` | `#F2EDE0` | 主文字 |
| `--text-secondary` | `#5C5D54` | `#C1BAAA` | 次要文字 |
| `--primary` | `#92391C` | `#EF8B61` | 主要動作與索引 |
| `--on-primary` | `#FFFFFF` | `#171714` | 主要動作前景 |
| `--ai` | `#3F7062` | `#8DC6B4` | AI 狀態與動作 |
| `--on-ai` | `#FFFFFF` | `#171714` | AI 動作前景 |
| `--danger` | `#A13F36` | `#EF8B82` | 危險操作 |
| `--on-danger` | `#FFFFFF` | `#171714` | 危險操作前景 |

### Archive 專用材質

| Token | 值／規則 |
| --- | --- |
| Compact Rail | Light／Dark 均以深墨 `#25241F` 為主；active `#3B3931` |
| Index | `#EF8B61`，搭配 `#171714` 前景 |
| Paper | Light `#FFFDF7`；Dark `#272720` |
| Canvas rule | 32 px 水平基線，低透明銅橘，不干擾正文 |
| Radius | 2／3／4／6 px；只有 Dialog 等浮層可使用較大圓角 |
| Shadow | 常態區域不用陰影；只在浮層與登入表面使用三級 shadow token |

顏色不可單獨傳達狀態；active、success、warning、danger 同時使用 icon、文字、底色或邊線。正文對比至少 4.5:1，大字與 UI boundary 至少 3:1。

## 5. 排版、密度與品牌

- 沿用 Inter、Noto Sans TC、JetBrains Mono，不新增字型或動畫依賴。
- 產品與頁面名稱使用現有 sans 字體；索引、sidebar label 與 archive kicker 使用 mono 大寫字距。
- 原創 `ArchiveMark` SVG 使用文件、索引與裝訂線語彙，不沿用第三方品牌資產。
- Dashboard、Admin 與列表採密集但可讀的 32／40／48 px 節奏；卡片只保留給真正可點擊的內容單位。
- 文件正文維持適合繁中閱讀的行寬與行高，不以裝飾性襯線或偽斜體處理中文。

## 6. Shell 行為

### App Shell

- Desktop `≥1024`：展開時為 288 px 單一 Archive Sidebar＋彈性 Canvas；收合時為 72 px compact rail＋彈性 Canvas。
- Sidebar 可由按鈕或 `Cmd/Ctrl+\\` 收合，狀態沿用 `jetbook-sidebar-collapsed`；Space route 預設 compact rail，可臨時展開全域 Space Dock。
- `<1024`：Rail 與 Dock 隱藏，Topbar 導覽按鈕開啟左側 Drawer。
- Drawer 支援 Tab focus trap、Esc、關閉鈕與關閉後 focus restore。
- Topbar 保留搜尋、建立、AI、通知、主題、使用者與 UI 回切入口；狹窄畫面依優先序收合文字，不刪功能。

### Admin Shell

- 使用同一 ArchiveMark、Rail、token 與主題規則。
- Rail 對應使用者、群組、Space、AI、稽核、系統與返回 App；只改呈現，不更動既有 admin guard。

### Auth 與 system states

- Archive Auth Frame 套用於登入、忘記密碼與重設密碼；既有 form、rate limit、防枚舉、OIDC 條件與 action 不變。
- 403、404、error 與 offline 使用 Archive 系統狀態；Legacy 分支保留既有呈現。
- loading、empty、error、permission 與 offline 都必須有明確原因與下一步，不顯示空白容器。

### Editor focus mode

- 文件 Canvas 為唯一視覺主角；Archive 編輯路由不常駐 Space 頁面樹或右側 Inspector，Legacy 不受影響。
- 頂列只保留返回、autosave、編輯鎖、按需展開的文件狀態與完成編輯。鎖定、版本、AI 與衝突說明收進具 Esc／focus restore 的 Popover。
- 桌面在標題下提供區塊、圖片、附件、表格快捷插入；完整內容類型仍由 Slash menu 提供。選取文字時以官方 TipTap BubbleMenu 顯示粗體、斜體、刪除線、行內程式碼，AI 寫作維持獨立工作層。
- `<768px` 改用固定底部工具列，正文保留底部安全距離；頁面樹不占用垂直寫作空間。

## 7. 無障礙與響應式驗收

- 斷點：320、768、1024、1440 px；不得產生頁面水平溢位。
- icon-only button 必須有可讀名稱；heading 不跳級。
- Dialog／Drawer／Command Palette 需 focus trap、Esc 關閉與 focus restore。
- Cmd+K、Cmd/Ctrl+\\、Cmd/Ctrl+J 在 IME composition 中不得誤觸。
- Light／Dark 使用相同內容與狀態；system 主題維持 SSR 防 FOUC。
- `prefers-reduced-motion: reduce` 將 animation／transition 壓至 `0.01ms` 並停用平滑捲動。
- 每批在 production build 以 Playwright 檢查 console error／warning、失敗網路請求與關鍵截圖。

## 8. 六批遷移順序

1. Token、基礎元件、可逆 rollout、App／Admin Shell、Auth 與 system states。**已完成：#251／PR #252。**
2. Dashboard、Spaces／Collections、頁面樹、回收桶與 Space 設定。**已完成：#253／PR #254。**
3. 閱讀、內容區塊、留言、版本、附件與預覽。**已完成：#255／PR #256。**
4. 編輯器、鎖定／衝突、完整區塊、AI 寫作與匯入。**已完成：#257／PR #258；編輯體驗迭代：#263。**
5. 搜尋、Cmd+K、AI、通知、個人設定、API Token／Docs。**已完成：#259／PR #260。**
6. 管理後台完整視覺、響應式收尾、無障礙與視覺回歸。**已完成：#261／PR #262。**

每批只能新增 Archive presentation 並重用既有內容／商業元件；舊 token 以相容別名保留，直到矩陣零遺留後才另開 removal issue。
