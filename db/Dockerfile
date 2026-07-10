FROM postgres:16

# pgvector：向量檢索（page_embeddings HNSW）
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-16-pgvector \
    && rm -rf /var/lib/apt/lists/*

# 中文全文檢索 extension（zhparser vs pgroonga）由 M0 A-10 spike 定案後在此加裝：
#   pgroonga：curl PGDG/Groonga APT repo 安裝 postgresql-16-pgroonga
#   zhparser：需 build from source（scws + zhparser）
# 定案前 search_tsv 先以 simple parser 建立，介面不變。

COPY init/ /docker-entrypoint-initdb.d/
