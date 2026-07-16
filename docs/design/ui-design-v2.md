# JetBook UI Design v2 — Archive Studio／知識工坊

> 狀態：已選定，分六個順序 issue／PR 漸進實作。第一批追蹤於 #251；原始兩案與 16 張 mock 見 `docs/design/mockups-v2/`。

## 1. 設計方向

### Visual thesis

JetBook 是工程師使用的活文件檔案室：以紙張、索引、檔案標籤與工作檯建立品牌辨識，讓知識本身成為畫面主角，而不是套用通用 SaaS 卡片外觀。

### Content plan

1. 72 px Command Rail 固定全域層級：首頁、所有空間、搜尋、AI 與設定。
2. 252 px Space Dock 承載首頁入口、Collection、Space 與頁面樹。
3. 中央 Canvas 保留原路由內容與操作，逐批改造成閱讀／編輯工作檯。
4. Inspector 只在任務需要時顯示 TOC、留言、編輯鎖、版本或 AI，不永久壓縮內容。

### Interaction thesis

- Rail 與 Space Dock 分層；桌面可收合 Dock，行動版改用具 focus trap／restore 的 Drawer。
- 閱讀進入編輯時維持文件位置，替換工具與 Inspector，避免重新定位。
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

## 3. 可逆 rollout

Archive Studio 以 Strangler pattern 與 Legacy 同時存在，選擇結果由伺服器在 SSR 階段寫入 `html[data-ui-version]`，避免 hydration 差異與畫面閃動。

| `UI_V2_ROLLOUT` | 無偏好預設 | 使用者切換 | 用途 |
| --- | --- | --- | --- |
| `off` | Legacy | 隱藏；任何 cookie 都被忽略 | 全域 kill switch／緊急回退 |
| `opt-in` | Legacy | Legacy ⇄ Archive | 小規模試用與功能覆蓋驗證 |
| `on` | Archive | Archive ⇄ Legacy | Archive 預設上線、仍可個別回退 |

- 偏好 cookie：`jetbook-ui-version=legacy|archive`，HttpOnly、SameSite=Lax、全站路徑、180 天。
- `BASE_URL` 為 HTTPS 時 cookie 啟用 Secure。
- rollout 設定只從 `src/lib/env.ts` 取得；預設 `off`。
- `off` 的優先權高於使用者偏好，部署不需重新 build 即可回退。

Legacy presentation layer 僅在六批功能矩陣完成、N-02／N-04、深淺視覺回歸、鍵盤與響應式驗證全綠，且搜尋確認零 active usage 後移除。

## 4. 語意 token

Archive token 只在 `html[data-ui-version="archive"]` 覆寫現有語意別名；Legacy token 保留原值。既有元件可繼續使用 `bg-base`、`text-fg`、`border-edge` 等 utility，不需要複製整套元件。

### 核心色彩

| Token | Light | Dark | 用途 |
| --- | --- | --- | --- |
| `--bg-base` | `#EFECE4` | `#171714` | Canvas／主工作檯 |
| `--bg-sidebar` | `#F8F5ED` | `#1E1F1B` | Space Dock／次層表面 |
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
| Command Rail | Light／Dark 均以深墨 `#25241F` 為主；active `#3B3931` |
| Index | `#EF8B61`，搭配 `#171714` 前景 |
| Paper | Light `#FFFDF7`；Dark `#272720` |
| Canvas rule | 32 px 水平基線，低透明銅橘，不干擾正文 |
| Radius | 2／3／4／6 px；只有 Dialog 等浮層可使用較大圓角 |
| Shadow | 常態區域不用陰影；只在浮層與登入表面使用三級 shadow token |

顏色不可單獨傳達狀態；active、success、warning、danger 同時使用 icon、文字、底色或邊線。正文對比至少 4.5:1，大字與 UI boundary 至少 3:1。

## 5. 排版、密度與品牌

- 沿用 Inter、Noto Sans TC、JetBrains Mono，不新增字型或動畫依賴。
- 產品與頁面名稱使用現有 sans 字體；索引、Rail label 與 archive kicker 使用 mono 大寫字距。
- 原創 `ArchiveMark` SVG 使用文件、索引與裝訂線語彙，不沿用第三方品牌資產。
- Dashboard、Admin 與列表採密集但可讀的 32／40／48 px 節奏；卡片只保留給真正可點擊的內容單位。
- 文件正文維持適合繁中閱讀的行寬與行高，不以裝飾性襯線或偽斜體處理中文。

## 6. Shell 行為

### App Shell

- Desktop `≥1024`：72 px Command Rail＋252 px Space Dock＋彈性 Canvas。
- Dock 可由按鈕或 `Cmd/Ctrl+\\` 收合，狀態沿用 `jetbook-sidebar-collapsed`。
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

## 7. 無障礙與響應式驗收

- 斷點：320、768、1024、1440 px；不得產生頁面水平溢位。
- icon-only button 必須有可讀名稱；heading 不跳級。
- Dialog／Drawer／Command Palette 需 focus trap、Esc 關閉與 focus restore。
- Cmd+K、Cmd/Ctrl+\\、Cmd/Ctrl+J 在 IME composition 中不得誤觸。
- Light／Dark 使用相同內容與狀態；system 主題維持 SSR 防 FOUC。
- `prefers-reduced-motion: reduce` 將 animation／transition 壓至 `0.01ms` 並停用平滑捲動。
- 每批在 production build 以 Playwright 檢查 console error／warning、失敗網路請求與關鍵截圖。

## 8. 六批遷移順序

1. Token、基礎元件、可逆 rollout、App／Admin Shell、Auth 與 system states。
2. Dashboard、Spaces／Collections、頁面樹、回收桶與 Space 設定。
3. 閱讀、內容區塊、留言、版本、附件與預覽。
4. 編輯器、鎖定／衝突、完整區塊、AI 寫作與匯入。
5. 搜尋、Cmd+K、AI、通知、個人設定、API Token／Docs。
6. 管理後台完整視覺、響應式收尾、無障礙與視覺回歸。

每批只能新增 Archive presentation 並重用既有內容／商業元件；舊 token 以相容別名保留，直到矩陣零遺留後才另開 removal issue。
