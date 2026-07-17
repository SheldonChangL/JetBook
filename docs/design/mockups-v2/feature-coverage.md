# JetBook UI Redesign — 完整功能覆蓋矩陣

> 本矩陣以 2026-07-16 `main` 的路由、元件、`messages/zh-TW.json` 與 `PROJECT_STATE.md` 為來源。Mock 圖是代表畫面，不等於只改四頁；表內所有現有 UI 都必須在選案後的實作 issue 中得到對應設計。

正式規格見 `docs/design/ui-design-v2.md`。Archive Studio 第一批 #251／PR #252 已建立可逆 rollout、語意 token、App／Admin Shell、Auth Frame 與 403／404／error／offline presentation；第二批 #253／PR #254 已覆蓋 Dashboard、Spaces／Collections、Space overview／page tree、回收桶與 Space settings；第三批 #255 開始遷移閱讀、內容區塊、留言、版本、附件與預覽。後續頁面仍依本矩陣的 slice 3–6 逐批遷移，未完成前保留 Legacy。

## 正式實作對應（#253）

- Dashboard：`src/app/(app)/page.tsx` 的 `archive-dashboard*` presentation；最近瀏覽、最近更新、我的 Space 與三種空狀態均重用原查詢及權限結果。
- Spaces／Collections：`src/app/(app)/spaces/page.tsx` 的 `archive-space-index*`；建立 Space／Collection、改名／刪除 Collection、空分組與 Space 指派仍使用原 action／Modal／Select。
- Space overview／page tree：`src/app/(app)/s/[spaceSlug]/` 與 `src/components/tree/page-tree.tsx`；page／group／external-link、根節點建立、匯入、DnD、同／跨 Space 搬移／複製、改名與軟刪入口均保留。Space route 預設只顯示情境 page-tree Dock，全域 Space Dock 可由頂列或 `Cmd/Ctrl+\\` 臨時展開。
- 回收桶：`src/app/(app)/trash/page.tsx` 與 `src/components/trash/trash-list.tsx`；全域／單 Space、子樹數、還原根層、剩餘天數與空狀態均保留。永久清除仍只由既有 30 天 worker 排程執行，未新增手動硬刪功能。
- Space settings：`src/app/(app)/s/[spaceSlug]/settings/`；一般資訊、可見性、成員、群組、匯入、匯出、封存、刪除八區均可由 Archive task index 到達，所有表單、確認與權限規則重用原元件。

## 覆蓋標記

- **主圖**：16 張代表 mock 中直接可見。
- **矩陣**：第一輪不另外產圖，但互動位置、狀態與後續 implementation slice 已確定。
- **後端保留**：功能沒有獨立畫面，保留既有 API／安全行為，由相鄰 UI 提供入口或說明。

## 認證、全域 Shell 與系統狀態

| 現有入口             | 功能與必要狀態                                                                 | Mock 證據                      | 後續 slice |
| -------------------- | ------------------------------------------------------------------------------ | ------------------------------ | ---------- |
| `/login`             | 本地帳密、顯示密碼、記住我、rate limit、鎖定倒數、條件式 OIDC／SSO             | 矩陣；沿用選定品牌標誌與 token | 1          |
| `/forgot-password`   | Email 送出、未知帳號防枚舉、成功提示                                           | 矩陣                           | 1          |
| `/reset-password`    | token 有效／失效／過期、密碼規則、成功登入                                     | 矩陣                           | 1          |
| App Shell            | Logo、全域搜尋、建立、AI、通知、主題、使用者選單                               | 四張主圖                       | 1          |
| App Shell sidebar    | Dashboard、Spaces、全域回收桶、Collection 分組、Space 列表、收合與行動 overlay | Dashboard／閱讀主圖            | 1、2       |
| Admin Shell          | 使用者、群組、Space、AI、稽核、系統、返回 App                                  | 矩陣                           | 1、6       |
| User menu            | 個人設定、管理後台權限顯示、登出                                               | Dashboard 主圖                 | 1          |
| Theme                | `light`／`dark`／`system`、SSR 防 FOUC、本機覆蓋、快捷鍵                       | 全部主圖具 light／dark 對照    | 1          |
| Notification bell    | 未讀徽章、清除全部、留言回覆、Mention、空狀態                                  | Dashboard 主圖＋矩陣           | 5          |
| Offline banner       | 斷線、重連、禁止承諾本機暫存                                                   | 矩陣                           | 1          |
| `/forbidden`         | 403、返回、可申請權限時的 CTA                                                  | 矩陣                           | 1          |
| `not-found`／`error` | 404、全域錯誤、重試與返回                                                      | 矩陣                           | 1          |

## Dashboard、Space、Collection 與頁面樹

| 現有入口           | 功能與必要狀態                                             | Mock 證據            | 後續 slice |
| ------------------ | ---------------------------------------------------------- | -------------------- | ---------- |
| `/`                | 問候、最近瀏覽、最近更新、我的 Space、空狀態               | Dashboard 主圖       | 2          |
| `/spaces`          | 可存取 Space、visibility、空狀態、建立 Space               | Dashboard 主圖＋矩陣 | 2          |
| Collections        | 建立、改名、刪除、空 Collection、Space 指派                | Dashboard 左欄＋矩陣 | 2          |
| 建立 Space Modal   | 名稱、emoji、描述、private 預設、失敗                      | 矩陣                 | 2          |
| `/s/[spaceSlug]`   | Space 首頁、頁面樹、群組／外部連結節點、建立根頁           | 閱讀左欄＋矩陣       | 2          |
| Page tree          | 無限階層、收展、選取、鍵盤、拖曳、同／跨 Space 搬移、複製  | 閱讀／編輯主圖       | 2          |
| Tree node menu     | 新子頁、改名、emoji、移動、複製、軟刪、子頁數警告          | 矩陣                 | 2          |
| Group node         | 純分節、不開頁、可排序與改名                               | 閱讀左欄             | 2          |
| External link node | 外部圖示、開新頁、防止誤作內頁                             | 閱讀左欄             | 2          |
| `/trash`           | 全域／單 Space、剩餘天數、子樹數、還原根層、清除中／空狀態 | Dashboard 左欄＋矩陣 | 2          |

## Space 設定與治理

| 現有入口                  | 功能與必要狀態                                                                    | Mock 證據                       | 後續 slice |
| ------------------------- | --------------------------------------------------------------------------------- | ------------------------------- | ---------- |
| `/s/[spaceSlug]/settings` | 設定導覽、返回 Space、權限不足 404                                                | 矩陣                            | 2          |
| 一般設定                  | emoji、名稱、描述、dirty／saving／success／error                                  | 編輯 Inspector 視覺語言＋矩陣   | 2          |
| Visibility                | private／org_read／org_write、變更確認                                            | Dashboard visibility chip＋矩陣 | 2          |
| 成員                      | 搜尋使用者、加入、commenter／reader／editor／admin、改角色、移除、最後 admin 防護 | 矩陣                            | 2          |
| 群組授權                  | 掛群組、改角色、移除、空狀態                                                      | 矩陣                            | 2          |
| 匯入                      | Markdown／ZIP、Word `.docx`、圖片轉附件、進度、部分失敗                           | Dashboard 快速入口＋編輯主圖    | 4          |
| 匯出                      | Markdown／ZIP job、輪詢、下載、失敗重試                                           | 矩陣                            | 4          |
| 封存／刪除                | 封存切換、軟刪、危險確認、已封存限制                                              | 矩陣                            | 2          |

## 閱讀、內容區塊、協作與版本

| 現有入口            | 功能與必要狀態                                                        | Mock 證據                 | 後續 slice |
| ------------------- | --------------------------------------------------------------------- | ------------------------- | ---------- |
| `/s/[space]/[page]` | 麵包屑、title、metadata、貢獻者、閱讀時間、權限動作                   | 閱讀主圖                  | 3          |
| 閱讀動作            | 編輯、留言、歷史、複製連結／Markdown、下載 Markdown、移動、刪除       | 閱讀主圖＋矩陣            | 3          |
| TOC                 | H2／H3、scroll spy、桌面 Inspector、窄螢幕下拉                        | 閱讀 Inspector            | 3          |
| 內容基礎            | 段落、H1–H3、粗體、底線、刪除線、行內 code、引用、分隔線              | 閱讀主圖＋矩陣            | 3          |
| 清單                | 無序、有序、task list、checked state                                  | 矩陣                      | 3          |
| Code block          | 語言、語法高亮、行號、複製、水平捲動                                  | 矩陣                      | 3          |
| Table               | 表頭、寬表跳出閱讀欄、窄螢幕水平捲動                                  | 閱讀主圖                  | 3          |
| Callout             | info／success／warning／danger、emoji、非純色提示                     | 閱讀主圖                  | 3          |
| 圖片                | caption、尺寸、lightbox、鍵盤、前後張                                 | 矩陣                      | 3          |
| 附件                | 下載、檔案型別／大小、權限錯誤                                        | 閱讀主圖                  | 3          |
| PDF 預覽            | inline Modal、nosniff、不改下載行為                                   | 閱讀主圖                  | 3          |
| Office 預覽         | 轉檔中輪詢、完成、失敗冷卻／重試、無 Gotenberg 降級                   | Dashboard／編輯主圖＋矩陣 | 3          |
| Inline document     | 高度調整、空狀態、顯眼插入入口                                        | 編輯主圖＋矩陣            | 3、4       |
| Tabs／摺疊／Stepper | 閱讀與編輯同構、鍵盤                                                  | 編輯主圖                  | 3、4       |
| Mermaid             | Markdown fence、既有 codeBlock fallback、閱讀放大、縮放／拖曳／百分比 | 閱讀／編輯主圖            | 3、4       |
| Embed               | allowlist、blocked／invalid／loading、外部連結 fallback               | 矩陣                      | 3、4       |
| Mention／Page link  | 使用者、頁面、通知、unresolved、已刪除 chip 與回收桶入口              | 矩陣                      | 3、4       |
| Comments            | 建立、回覆、編輯、刪除、resolve／reopen、moderation、空與錯誤         | 閱讀 Inspector            | 3          |
| `/history`          | 版本清單、snapshot、diff、author、空狀態                              | 閱讀版本入口＋矩陣        | 3          |
| Version restore     | 確認、建立新版本、成功／失敗                                          | 矩陣                      | 3          |

## 編輯器與衝突防護

| 現有入口       | 功能與必要狀態                                                 | Mock 證據                | 後續 slice |
| -------------- | -------------------------------------------------------------- | ------------------------ | ---------- |
| `/edit`        | 返回、完成編輯、title、icon、正文、編輯資訊                    | 編輯主圖                 | 4          |
| Autosave       | saving／saved／network error／retry、`⌘S` 回饋                 | 編輯頂列                 | 4          |
| 編輯鎖         | 取得、心跳、接近逾時、逾時重取、他人持鎖唯讀、Admin 搶鎖、確認 | 編輯 Inspector＋矩陣     | 4          |
| 樂觀衝突       | currentVersion、保留本機內容、複製我的變更、重新載入           | 編輯 Inspector＋矩陣     | 4          |
| Block controls | hover 把手、插入、拖曳、複製、轉換、上下移動、刪除             | 編輯主圖                 | 4          |
| Slash menu     | 分組、中英關鍵字、keyboard、H1–H3、完整 block 清單             | 編輯主圖                 | 4          |
| Inline toolbar | B／I／U／S／code／link／文字色／底色、`⌘K` 雙義                | 矩陣                     | 4          |
| Markdown       | 快捷輸入、貼上、表格與 Mermaid fence 轉換                      | 編輯主圖＋矩陣           | 4          |
| 圖片上傳       | 選檔、拖放、貼上、進度、失敗重試、resize、caption              | 編輯主圖                 | 4          |
| 多附件         | 多選、拖放、個別進度／失敗、Office preview 狀態                | 編輯主圖                 | 4          |
| Table editor   | 插入格數、增刪欄列、表頭、對齊、欄寬                           | 編輯主圖＋矩陣           | 4          |
| Code editor    | 語言搜尋、行號、Tab、Esc                                       | 矩陣                     | 4          |
| AI assist      | 續寫、摘要、翻譯、精簡、正式化、修正文法、stream／stop／error  | 編輯主圖                 | 4          |
| IME            | composition 中不觸發單鍵或送出快捷鍵                           | 矩陣；browser acceptance | 4、6       |

## 搜尋、Cmd+K 與 AI

| 現有入口        | 功能與必要狀態                                                               | Mock 證據      | 後續 slice |
| --------------- | ---------------------------------------------------------------------------- | -------------- | ---------- |
| `/search`       | 關鍵字、URL query、Space／updated／type filters、排序、empty／loading／error | 搜尋主圖       | 5          |
| 全文結果        | icon、title、path、highlight、權限過濾                                       | 搜尋主圖       | 5          |
| 語意結果        | feature availability、分區、score 表達、權限過濾                             | 搜尋主圖       | 5          |
| 附件搜尋        | 檔名結果、所在頁、PDF／Office 預覽、轉檔中                                   | 搜尋主圖       | 5          |
| Cmd+K           | 最近瀏覽、全文、語意、問 AI、show all、鍵盤／新分頁、失敗                    | 搜尋主圖＋矩陣 | 5          |
| AI Drawer       | 全域 `⌘J`、close、empty、輸入、composition、send／stop／retry                | 搜尋主圖       | 5          |
| AI conversation | 歷史、多輪、目前對話、來源卡、引用跳轉                                       | 搜尋主圖       | 5          |
| AI SSE          | retrieving／generating、stream cursor、stop、斷線與 retry                    | 搜尋主圖       | 5          |
| AI governance   | disabled、unauthorized、rate limited、quota exceeded、failed、disclaimer     | 搜尋主圖＋矩陣 | 5、6       |

## 個人設定、API 與管理後台

| 現有入口             | 功能與必要狀態                                                              | Mock 證據                                  | 後續 slice |
| -------------------- | --------------------------------------------------------------------------- | ------------------------------------------ | ---------- |
| `/settings` Profile  | 顯示名稱、readonly email、saving／success／error                            | 矩陣                                       | 5          |
| Password             | 本地帳號才顯示、舊密碼、新密碼、規則與錯誤                                  | 矩陣                                       | 5          |
| Appearance           | light／dark／system、持久化                                                 | 16 張 light／dark                          | 5          |
| Email prefs          | master toggle、reply、Mention 等逐類開關                                    | 矩陣                                       | 5          |
| API Tokens           | 建立、名稱、到期、read／write scope、只顯示一次、複製、revoke、last used    | 矩陣                                       | 5          |
| `/api-docs`          | OpenAPI endpoints、參數 required／optional、raw spec、Bearer 說明           | 矩陣                                       | 5          |
| REST API v1          | list／search／read／create／update／move／delete、Space 管理                | 後端保留；API Docs／Token 提供 UI          | 5          |
| MCP Server           | list／search／read／create／update／move／delete、附件匯入、Space 管理      | 後端保留；API Token 與 Docs／guide 提供 UI | 5          |
| `/admin/users`       | 搜尋、狀態、分頁、create、org role、active、reset password                  | 矩陣                                       | 6          |
| CSV user import      | Redmine 欄名、選檔、preview validation、批次結果、welcome mail              | 矩陣                                       | 6          |
| `/admin/groups`      | list、create、rename、description、delete、row actions                      | 矩陣                                       | 6          |
| `/admin/groups/[id]` | member search、add／remove、empty／error                                    | 矩陣                                       | 6          |
| `/admin/spaces`      | soft-deleted Spaces、剩餘天數、restore、empty                               | 矩陣                                       | 6          |
| `/admin/ai`          | provider masked config、test LLM／embedding、reindex、quota、usage chart    | Dashboard Inspector 語言＋矩陣             | 6          |
| `/admin/audit`       | actor／action／resource／date filters、table、pagination、CSV export、empty | 矩陣                                       | 6          |
| `/admin/system`      | service health、database、worker、backup、metrics、reindex status           | Dashboard Inspector＋矩陣                  | 6          |

## 跨畫面狀態與驗收

| 狀態       | 設計要求                                                         | 驗證                          |
| ---------- | ---------------------------------------------------------------- | ----------------------------- |
| Loading    | 內容 skeleton 保留版面，不以全頁 spinner 取代                    | Playwright 代表頁             |
| Empty      | 標題、原因、下一步 CTA；不顯示空白容器                           | route fixtures                |
| Error      | 原位置訊息、可重試時提供 retry、不清除使用者輸入                 | route fixtures                |
| Permission | 隱藏無權操作；private 404、org-visible 403 行為不變              | 既有 integration／E2E         |
| Offline    | 全域 banner、autosave retry、禁止宣稱離線持久化                  | browser network simulation    |
| Focus      | 邏輯順序、清楚 focus-visible、Dialog／Drawer focus trap／restore | keyboard walkthrough          |
| Contrast   | 正文至少 4.5:1；大字與 UI boundary 至少 3:1                      | token contrast audit          |
| Motion     | 只用 opacity／translate；reduced-motion 停用                     | media emulation               |
| IME        | composition 中不誤觸 E／C／`?`／搜尋送出／AI 送出                | Playwright composition events |
| Responsive | 320／768／1024／1440；側欄和 Inspector 依序轉 Drawer／sheet      | Playwright screenshots        |
| Theme      | 關鍵頁 light／dark、system、SSR 無 FOUC                          | Playwright screenshots        |

## 明確不納入「現有功能遺失」檢查的 backlog

下列項目尚未是目前可用功能，不會在本輪 mock 中偽裝成已完成：變更請求、行內評論、Webhooks、PDF 匯出、KaTeX、多欄、snippets、內容分析、即時共編、Git Sync、2FA、對外公開、離線模式、多租戶、整合市集。選案後若個別 issue 啟動，再沿用選定設計系統擴充。
