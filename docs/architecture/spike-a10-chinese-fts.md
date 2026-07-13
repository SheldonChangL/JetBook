# A-10 Spike 報告：中文全文檢索選型（zhparser vs pgroonga）

- 日期：2026-07-06
- 結論：**採用 pgroonga**（4.0.6，TokenBigram）。ADR-007 同步定案。
- 對應風險／審查編號：R2、C12

## 方法

- 測試語料：20 篇模擬真實內部文件（雷射/光學製程 SOP、規格書、IT 與行政規範），涵蓋公司名「凱銳光電」、料號（JB-1024/JB-2048）、中英混排（pgvector、ESD、force push）、專業術語（FWHM、準直鏡）。
- 驗收查詢 14 條，關鍵案例：**以「凱銳」查得含「凱銳光電」的文件**（子字串魯棒性，內建 parser 與詞庫式斷詞的典型破口）。
- 環境：官方 `groonga/pgroonga:latest-debian-16` image（PostgreSQL 16、arm64），`&@~` 查詢 + `pgroonga_score` 排序。

## 結果

### pgroonga：14/14 全數命中，無誤漏

| 查詢 | 命中（docs id） | 驗證點 |
|---|---|---|
| 凱銳 | 1, 20 | ✅ 子字串命中「凱銳光電」 |
| 凱銳光電 | 1, 20 | 完整詞命中 |
| 雷射校準 | 2 | 多詞 AND 語意正確（不誤中僅含「雷射」者） |
| 雷射 | 1,2,7,11,13,19 | 高頻詞 recall 完整 |
| JB-1024 / pgvector / force push | 各 1 筆 | ✅ 料號與中英混排 |
| 校準／波長校正 | 各自正確區分 | 「校準」不誤中「校正」 |
| 其餘（功率、防潮、無塵室、靜電防護、健檢） | 全部正確 | — |

`pgroonga_score` 排序與 `pgroonga_highlight_html` 高亮均可用。

### zhparser：build 失敗，維運成本實證偏高

- 無官方 Debian 套件，必須 from-source 編譯 SCWS + zhparser。
- 實測時 SCWS 官方來源（xunsearch.com）**不可達**，build 直接失敗——上游脆弱是長期維運風險，非一次性事故。
- 既有文獻（審查 R2）：SCWS 詞庫以簡中為主，zh-TW OOV（公司名、料號）需自維詞庫。
- 未進行斷詞品質實測（build 失敗即達時間盒上限）；成本面證據已足以支持決策。

### 附帶發現：安裝途徑

- `postgres:16` 官方 image base 已升至 Debian trixie；groonga APT repo 對 trixie（含 arm64）**沒有** `postgresql-16-pgroonga` 套件——apt 疊裝路線兩次失敗。
- **定案安裝方式**：`db/Dockerfile` 以官方 `groonga/pgroonga:latest-debian-16` 為 base，疊裝 PGDG 的 `postgresql-16-pgvector`。已實建實測：pgroonga 4.0.6 + pgvector 0.8.4 共存，驗收查詢通過。
- 部署硬化時將 image tag 釘到具體版本。

## 對下游 issue 的實作指引

1. **F-01（全文搜尋後端）**：查詢用 `&@~`（query 語法）＋ `pgroonga_score` 排序＋ `pgroonga_highlight_html` 高亮；標題加權以「title 與 body 分開索引、分數加權合併」實作。
2. **C-02（pages schema）**：`content_text` 保留；**不再需要 `search_tsv` tsvector 欄位**——pgroonga 索引直接建在 text 欄位上（`USING pgroonga`）。architecture 文件的 search_tsv 敘述以本報告為準修訂。
3. **N-01（testcontainers）**：整合測試 image 用同一個 `db/Dockerfile` 產物，確保測試與正式環境 extension 一致。
4. RAG hybrid 檢索（I-01）的全文路徑同樣走 pgroonga 查詢。
