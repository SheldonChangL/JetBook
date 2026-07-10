# A-10 spike 定案：中文全文檢索採 pgroonga（見 docs/architecture/spike-a10-chinese-fts.md）。
# 以官方 pgroonga image（postgres:16 衍生）為 base——groonga APT repo 對新 Debian
# base（trixie）/arm64 沒有 pg16 套件，官方 image 是唯一跨平台穩定來源。
# 部署硬化時將 tag 釘到具體版本（例：4.x-debian-16）。
FROM groonga/pgroonga:latest-debian-16

# pgvector：向量檢索（page_embeddings HNSW），來自 base image 內建的 PGDG repo
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-16-pgvector \
    && rm -rf /var/lib/apt/lists/*

COPY init/ /docker-entrypoint-initdb.d/
