-- 語意檢索向量索引（H-06，pgvector HNSW）。
-- HNSW 無法由 drizzle schema 表達，以自訂 migration 建立（同 0005 pgroonga 手法）。
-- cosine 距離（vector_cosine_ops）對應 BGE-M3 正規化向量的相似度；
-- m=16 / ef_construction=64 為 pgvector 通用預設（建索引成本與召回率的平衡點）。
CREATE INDEX IF NOT EXISTS ix_page_embeddings_hnsw
  ON page_embeddings USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
