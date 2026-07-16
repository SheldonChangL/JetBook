# JetBook UI Redesign — 方案比較

> Issue #249 第一輪設計探索。兩個方案只用於選定正式 UI 方向；本目錄沒有修改任何 `src/` 產品元件。

## 選案結果

- **選定方向：Archive Studio／知識工坊。** 使用者於 2026-07-16 確認，後續 UI Design v2 與六個順序實作 PR 均以此方向為準。
- Optic Grid 保留為探索紀錄，不混入正式資訊架構，避免形成未驗證的第三套方案。
- 過渡期採 Strangler／feature-flag 遷移：Legacy 與 Archive Studio presentation layer 並存；正式 URL、Server Action、REST、MCP、SSE、資料 schema、權限與主題偏好格式維持不變。
- Archive Studio 預設關閉並逐頁 opt-in；提供全域 rollout kill switch 與使用者切換，任一遷移切片可立即回到 Legacy UI。舊 presentation layer 僅在功能覆蓋、E2E 與零使用量驗證完成後移除。

## 固定條件

- 畫布：1440 × 900 px。
- 代表畫面：Dashboard／空間總覽、閱讀工作區、區塊編輯器、搜尋＋AI。
- 每個畫面以完全相同的資料與狀態輸出 light／dark；共 16 張 PNG。
- 使用現有 Inter、Noto Sans TC、JetBrains Mono 字型組合；無外部圖片、字型、動畫或 UI 相依。
- 介面內容使用繁體中文實際文案，不用 lorem ipsum。
- URL、Server Action、REST、MCP、SSE、資料 schema、權限和 `light | dark | system` 主題格式均不在設計探索範圍。

## 方案 A：Optic Grid／稜光格線

### Visual thesis

像一張精密光學設備的操作介面：冷靜、準確、低噪音，以青藍光譜訊號協助掃描與定位。

### Content plan

1. 全域頂欄提供跨 Space 搜尋、建立、AI、通知和帳號操作。
2. 左欄負責空間／頁面結構；不混入頁面內容動作。
3. 中央工作區承載 Dashboard、文件、編輯器或搜尋結果。
4. 右側 Inspector 只顯示當前任務需要的 TOC、留言、編輯鎖、系統或 AI 情境。

### Interaction thesis

- Space／頁面切換以短距離淡入和共享標題位置保持方向感。
- Inspector 從右側滑入，但不改變主要內容的閱讀寬度。
- Hover 才顯示次要操作；選取狀態以 2 px 光譜線和淡底同時表達，不只依賴顏色。

### 視覺系統

| 類別      | Light                              | Dark                         |
| --------- | ---------------------------------- | ---------------------------- |
| Canvas    | `#F7F9FB`                          | `#0B1117`                    |
| Surface   | `#FFFFFF`                          | `#101820`                    |
| Text      | `#17212B`                          | `#EDF7FA`                    |
| Accent    | `#006C82`                          | `#69D7E9`                    |
| AI accent | `#7256C8`                          | `#B7A5F3`                    |
| Material  | 1 px 細線、4–7 px 低圓角、極少陰影 | 邊框建立層級，浮層才使用陰影 |

### 適合情境與代價

- 適合需要快速上手、保留現有三欄心智模型及低風險漸進改造。
- 功能位置容易映射回現有 `AppShell`、頁面樹和 Inspector。
- 品牌個性較偏工程工具；需要靠原創標誌與內容密度避免看起來像通用 SaaS。

## 方案 B：Archive Studio／知識工坊

### Visual thesis

像工程師使用的活文件檔案室：紙張、索引、檔案標籤與工作檯的質感，讓知識本身成為畫面主角。

### Content plan

1. 72 px Command Rail 固定全域層級：首頁、知識庫、搜尋、AI、通知與設定。
2. Space Dock 顯示目前 Collection、Space 和頁面樹。
3. 中央內容像可閱讀、可編輯的文件工作檯，減少「卡片包卡片」。
4. Inspector 依任務切換目錄、留言、鎖定狀態或 AI，而不是永久塞滿控制項。

### Interaction thesis

- Command Rail 可展開成帶文字的工作列；收合時仍保留全域位置記憶。
- 從閱讀進入編輯時，文件本體維持原位，只替換工具與 Inspector。
- 搜尋與 AI 使用同一探索工作層，來源、引用、附件預覽和錯誤都在同一脈絡內完成。

### 視覺系統

| 類別      | Light                            | Dark                             |
| --------- | -------------------------------- | -------------------------------- |
| Canvas    | `#EFECE4`                        | `#171714`                        |
| Surface   | `#F8F5ED`                        | `#1E1F1B`                        |
| Text      | `#282A26`                        | `#F2EDE0`                        |
| Accent    | `#92391C`                        | `#EF8B61`                        |
| AI accent | `#3F7062`                        | `#8DC6B4`                        |
| Material  | 紙張色階、方形索引、襯線文件標題 | 墨色工作檯、暖色索引、無裝飾漸層 |

### 適合情境與代價

- 品牌辨識度較高，閱讀與編輯的連續性最好，也最不像既有 GitBook／SaaS 模板。
- Command Rail 能整合搜尋、AI、通知和管理入口，長期擴充清楚。
- 導航改造幅度較大；正式實作需要更完整的 E2E、鍵盤路徑與使用者適應驗證。

## 共同可用性規則

- 文字對比以 WCAG 2.1 AA 為最低要求；資訊不只用顏色表達。
- 所有 icon-only button 具可讀名稱；選單、Drawer、Dialog 必須可用鍵盤完成。
- 動效只使用 opacity／translate，並在 `prefers-reduced-motion: reduce` 下完全停用。
- Dashboard 不使用統一卡片矩陣；以列表、分隔線、工作層和真正需要點擊的項目建立層級。
- 中文標題不使用偽斜體；文件正文維持適合繁中閱讀的行寬與行高。

## 16 張輸出

命名格式：`{scheme}-{screen}-{theme}.png`。

| Scheme  | Screen    | Light                         | Dark                         |
| ------- | --------- | ----------------------------- | ---------------------------- |
| optic   | dashboard | `optic-dashboard-light.png`   | `optic-dashboard-dark.png`   |
| optic   | reading   | `optic-reading-light.png`     | `optic-reading-dark.png`     |
| optic   | editor    | `optic-editor-light.png`      | `optic-editor-dark.png`      |
| optic   | search    | `optic-search-light.png`      | `optic-search-dark.png`      |
| archive | dashboard | `archive-dashboard-light.png` | `archive-dashboard-dark.png` |
| archive | reading   | `archive-reading-light.png`   | `archive-reading-dark.png`   |
| archive | editor    | `archive-editor-light.png`    | `archive-editor-dark.png`    |
| archive | search    | `archive-search-light.png`    | `archive-search-dark.png`    |

## 選案判斷

- 優先考慮遷移風險、熟悉度與工程效率：選 Optic Grid。
- 優先考慮品牌差異、文件感與長期導航模型：選 Archive Studio。
- 可混合的部分限於 token 或細節，例如採 Archive Studio 導航搭配 Optic Grid 色彩；正式實作仍需選定一套版面骨架，避免產生第三套未驗證的混合資訊架構。
