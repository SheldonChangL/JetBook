#!/bin/sh
# JetBook 還原演練腳本（N-03；對應 NFR-DATA-04 每季演練）
# 將最新（或指定）dump 還原至一個臨時 scratch DB，並比對「表數」與「users 筆數」
# 與來源庫一致，作為「可還原」的客觀證據。演練用 scratch DB 用完即刪，不動正式庫。
#
# 用法：
#   docker compose run --rm backup restore-drill.sh            # 用最新 hourly dump
#   docker compose run --rm backup restore-drill.sh /backups/db/daily/jetbook-2026-07-11.dump
set -eu

: "${PGHOST:=db}"
: "${PGPORT:=5432}"
: "${PGUSER:=jetbook}"
: "${PGDATABASE:=jetbook}"
: "${BACKUP_ROOT:=/backups}"
: "${SCRATCH_DB:=jetbook_restore_drill}"

export PGHOST PGPORT PGUSER

log() { echo "[restore-drill $(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

DUMP="${1:-}"
if [ -z "$DUMP" ]; then
  DUMP="$(ls -1t "$BACKUP_ROOT"/db/hourly/jetbook-*.dump 2>/dev/null | head -1 || true)"
fi
if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
  log "ERROR: no dump file found (arg or $BACKUP_ROOT/db/hourly)"
  exit 1
fi
log "using dump: $DUMP"

count_tables() {
  psql -d "$1" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';"
}
count_users() {
  psql -d "$1" -tAc "SELECT count(*) FROM users;"
}

SRC_TABLES="$(count_tables "$PGDATABASE")"
SRC_USERS="$(count_users "$PGDATABASE")"
log "source: tables=$SRC_TABLES users=$SRC_USERS"

# 重建乾淨 scratch DB
psql -d postgres -c "DROP DATABASE IF EXISTS $SCRATCH_DB;" >/dev/null
psql -d postgres -c "CREATE DATABASE $SCRATCH_DB;" >/dev/null
log "scratch db created: $SCRATCH_DB"

# 還原（custom format，平行 job 加速）；pg_restore 對既存物件的 NOTICE 不視為失敗
set +e
pg_restore --no-owner --no-acl -j 2 -d "$SCRATCH_DB" "$DUMP"
RESTORE_RC=$?
set -e
log "pg_restore exit code: $RESTORE_RC"

DST_TABLES="$(count_tables "$SCRATCH_DB")"
DST_USERS="$(count_users "$SCRATCH_DB")"
log "restored: tables=$DST_TABLES users=$DST_USERS"

# 演練後清理 scratch DB
psql -d postgres -c "DROP DATABASE IF EXISTS $SCRATCH_DB;" >/dev/null
log "scratch db dropped"

if [ "$SRC_TABLES" = "$DST_TABLES" ] && [ "$SRC_USERS" = "$DST_USERS" ]; then
  log "RESULT: PASS (tables=$DST_TABLES, users=$DST_USERS match source)"
  exit 0
else
  log "RESULT: FAIL (source tables=$SRC_TABLES users=$SRC_USERS vs restored tables=$DST_TABLES users=$DST_USERS)"
  exit 1
fi
