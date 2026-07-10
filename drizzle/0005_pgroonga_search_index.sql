-- 中文全文檢索索引（ADR-007 pgroonga，A-10 spike 定案）。
-- pgroonga 索引無法由 drizzle schema 表達，以自訂 migration 建立。
-- 標題與內文分開索引，查詢時分數加權（標題權重高於內文，F-SEARCH-01）。
CREATE INDEX IF NOT EXISTS ix_pages_title_pgroonga
  ON pages USING pgroonga (title);

CREATE INDEX IF NOT EXISTS ix_pages_content_pgroonga
  ON pages USING pgroonga (content_text);
