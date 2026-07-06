# definition-of-done.md — JetBook 完成定義

任一 issue 標記完成、開 PR 之前，以下每一條都必須滿足。任何一條不滿足＝未完成。

## 功能

- [ ] Issue 的驗收標準**逐條**達成，且可實際操作驗證（不是「應該可以」）。
- [ ] 失敗路徑已處理：錯誤訊息（經 i18n）、交易 rollback、job retry；不只 happy path。
- [ ] 繁中相關功能通過 IME composition 檢查（編輯器／搜尋輸入不吃字、不誤觸快捷鍵）。

## 程式碼品質

- [ ] 無 TODO 註解、無 placeholder、無假 mock 邏輯（除非 issue 明文要求）。
- [ ] 符合 `constraints.md` 模組邊界與 `CLAUDE.md` 架構鐵律：authz 單一入口、設定走 `lib/env.ts`、UI 字串進 i18n、Server Action／Route Handler 薄殼、三衍生欄位同交易。
- [ ] auth 與 authz 模組禁用 `any`；新增程式碼有對應測試（核心模組行覆蓋率 ≥ 80% 目標）。

## 驗證（全綠才可開 PR）

- [ ] `npm run lint` 零錯誤
- [ ] `npm run typecheck`（`tsc --noEmit`）零錯誤
- [ ] `npm run test` 全數通過（存在測試就必須跑）
- [ ] `npm run build` 成功
- [ ] **權限相關變更**（authz、space/page 權限、session、RAG 過濾）：必附**整合測試**（testcontainers 真 PG），涵蓋授權與拒絕兩向。
- [ ] **未弱化**既有 authz 檢查與 RAG 權限過濾；N-04 RAG 權限隔離測試維持通過（M2 起）；N-02 E2E 冒煙維持全綠（M1 起）。
- [ ] 涉及 schema：migration 可套用至乾淨 compose DB，且 schema 與 migration 一致（CI 驗證）。

## 文件與狀態

- [ ] 架構影響變更（schema、選型、模組邊界、部署、安全模型）已新增／修訂 `ARCHITECTURE_DECISIONS.md` 的 ADR。
- [ ] `PROJECT_STATE.md` 已更新：current branch、active issue、完成事項、blockers、下一步。
- [ ] 受影響的 `docs/specs/`、`docs/plans/` 章節已同步，文件與程式碼無矛盾。
- [ ] 新增依賴已在 PR 說明授權與理由。

## 交付規範

- [ ] Branch：`feature/issue-<n>-<short-slug>`；未直推 `main`。
- [ ] Commit：`feat(issue-<n>): <摘要>`（或 `fix`/`refactor`/`chore`/`docs`/`test`）；subject 一句、body 短 bullet；無 `Co-Authored-By:`、無 generated-with 附加行。
- [ ] PR body 含 `Fixes #<n>`＋驗證結果摘要（lint/typecheck/test/build 輸出重點）。
