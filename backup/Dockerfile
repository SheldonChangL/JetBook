# syntax=docker/dockerfile:1
# JetBook 備份 sidecar（N-03）：PostgreSQL 16 client + busybox crond + rsync
# 以官方 postgres:16-alpine 為 base——確保 pg_dump/pg_restore 主版本與 db（PG16）一致，
# 避免跨主版本 dump/restore 不相容。硬化部署時將 tag 釘到具體 patch 版本。
FROM postgres:16-alpine

# rsync：附件 volume 鏡像；tzdata：讓日備日期判定可依在地時區（預設 UTC）
RUN apk add --no-cache rsync tzdata

COPY backup.sh /usr/local/bin/backup.sh
COPY restore-drill.sh /usr/local/bin/restore-drill.sh
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore-drill.sh /usr/local/bin/entrypoint.sh

# 備份資料落於掛載的 named volume；宣告掛載點
VOLUME ["/backups"]

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
