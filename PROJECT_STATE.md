# PROJECT_STATE.md — JetBook 專案狀態

> 每個 issue 完成、或狀態有變（blockers、範圍調整）時必須更新本檔。

## 專案

**JetBook** — 捷揚光電（Jet Opto）內部知識管理系統（類 GitBook）。
Next.js（App Router、TS strict）全端 + PostgreSQL 16/pgvector + Docker Compose；AI RAG 問答（前期 Claude API → 後期 Local LLM，經 Provider 抽象層以 env 切換）；繁體中文預設。

## 目前階段

**規劃完成，待開工 M0（專案骨架與基礎設施）。** 尚無應用程式碼。

## 已完成

- [x] 功能需求規格落地（Must 42 / Should 28 / Could 17 / Won't 7，共 94 項）：`docs/specs/functional-requirements.md`
- [x] NFR 落地（稽核與備份已升 Must/P0）：`docs/specs/non-functional-requirements.md`
- [x] 系統架構與 ADR：`docs/architecture/system-architecture.md`、`ARCHITECTURE_DECISIONS.md`
- [x] UI/UX 設計規格（已套用 C2：移除發布按鈕／草稿側欄／僅發布版篩選）：`docs/design/ui-design.md`
- [x] 完整性審查報告（28 項發現 C1–C12／G1–G11／R1–R6，修正決議已套用至各文件）：`docs/design/review-report.md`
- [x] 交付拆解（M0–M4、14 epics、70+ tasks、dependency map）：`docs/plans/issue-plan.md`、`docs/plans/milestones.md`、`docs/plans/dependency-map.md`
- [x] 工作流文件：`CLAUDE.md`、`constraints.md`、`definition-of-done.md`、本檔

## 關鍵已拍板決策（摘要，全文見 ADR）

- C1：軟性編輯鎖（locked_by/locked_at、心跳 30s、閒置 5 分釋放、Admin 可搶鎖）＋樂觀版本檢查備援
- C2：v1 直接編輯＋autosave＋自動版本快照，無草稿／發布閘門
- ORM＝Drizzle；佇列＝pg-boss；embedding day-1＝local BGE-M3（1024 維）
- 中文分詞（zhparser vs pgroonga）由 M0 A-10 spike 定案
- 兩道閘門：N-02（MVP E2E 全綠才上線）、N-04（RAG 權限隔離測試通過才開放 AI）

## GitHub 執行狀態

| 項目 | 狀態 |
|---|---|
| Repo / remote | 未建立、未掛接 |
| Labels | 未建立 |
| Milestones（M0–M4） | 未建立 |
| Issues | 未建立（依 `docs/plans/issue-plan.md` 建立） |
| Active issue | 無 |
| Current branch | `main`（僅規劃文件；initial commit 為 bootstrap 例外，此後一律 branch → PR） |

## Blockers

無。

## 下一步

1. 建 GitHub repo 並掛接本地 repo → 建 labels、Milestones M0–M4 → 依 `docs/plans/issue-plan.md` 建 issues（含驗收標準與依賴）。
2. 開工 **M0 A-01**（chore: 初始化 Next.js 專案與工具鏈——App Router + TS strict、ESLint/Prettier、`output: standalone`）。
3. 之後依 critical path 推進：A-01 → A-02 → A-04 → B-01 → C-01 → C-02 → B-03 → D-02 → E-01 → F-01 → [N-02 MVP 閘門] → H-06 → I-01…I-04 → [N-04 AI 閘門]。
