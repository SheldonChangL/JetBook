/**
 * JetBook 資料模型單一定義點（Drizzle schema）。
 *
 * 資料表於後續 issue 依「schema 一次補齊」原則加入（見 docs/plans/issue-plan.md）：
 * - B-01：users、sessions、groups、group_members、password_reset_tokens
 * - C-01：spaces、space_members、org_settings、space_pinned_pages、collections
 * - C-02：pages（含編輯鎖欄位）、page_slug_history、page_visits
 * - E-01：page_versions；M-01：attachments；H-06：page_embeddings…
 *
 * 所有 schema 變更一律走 drizzle-kit 版本化 migration（npm run db:generate → db:migrate），
 * 禁止手改線上 schema；migration 為獨立部署步驟，不在 app 啟動時隱式執行（ADR/K8s 準備）。
 */

export {};
