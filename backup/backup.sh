#!/bin/sh
# JetBook 備份腳本（N-03）
# 單次執行內容：
#   1) pg_dump -Fc 全庫邏輯備份（custom format，可平行還原）
#   2) 小時輪替：保留最新 HOURLY_KEEP 份（預設 48 → 覆蓋 48h）
#   3) 每日晉升：當日尚無日備則複製一份，日備保留 DAILY_KEEP_DAYS 天（預設 30）
#   4) uploads 附件 volume 以 rsync --delete 鏡像（來源唯讀）
#
# RPO：以每小時邏輯全備達成 RPO ≤ 1h（小庫合理；升級路徑見 runbook）。
# 由 crond 每小時觸發；亦可 `docker compose run --rm backup backup.sh` 單次執行。
set -eu

: "${PGHOST:=db}"
: "${PGPORT:=5432}"
: "${PGUSER:=jetbook}"
: "${PGDATABASE:=jetbook}"
: "${BACKUP_ROOT:=/backups}"
: "${UPLOAD_SRC:=/data/uploads}"
: "${HOURLY_KEEP:=48}"
: "${DAILY_KEEP_DAYS:=30}"

export PGHOST PGPORT PGUSER PGDATABASE

HOURLY_DIR="$BACKUP_ROOT/db/hourly"
DAILY_DIR="$BACKUP_ROOT/db/daily"
UPLOAD_MIRROR="$BACKUP_ROOT/uploads"

log() {
  echo "[backup $(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
}

mkdir -p "$HOURLY_DIR" "$DAILY_DIR" "$UPLOAD_MIRROR"

log "start: host=$PGHOST port=$PGPORT db=$PGDATABASE"

# --- 1) DB 全備 ---------------------------------------------------------------
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TMP_DUMP="$HOURLY_DIR/.jetbook-$STAMP.dump.partial"
DUMP="$HOURLY_DIR/jetbook-$STAMP.dump"

if ! pg_dump -Fc --no-owner --no-acl -f "$TMP_DUMP"; then
  log "ERROR: pg_dump failed"
  rm -f "$TMP_DUMP"
  exit 1
fi
mv "$TMP_DUMP" "$DUMP"
log "db dump ok: $DUMP ($(du -h "$DUMP" | cut -f1))"

# --- 2) 小時輪替：保留最新 HOURLY_KEEP 份 -------------------------------------
ls -1t "$HOURLY_DIR"/jetbook-*.dump 2>/dev/null | tail -n +"$((HOURLY_KEEP + 1))" | while IFS= read -r old; do
  rm -f "$old"
  log "pruned hourly: $old"
done

# --- 3) 每日晉升：當日一份，保留 DAILY_KEEP_DAYS 天 ---------------------------
DAILY_DUMP="$DAILY_DIR/jetbook-$(date -u +%Y-%m-%d).dump"
if [ ! -f "$DAILY_DUMP" ]; then
  cp "$DUMP" "$DAILY_DUMP"
  log "promoted daily: $DAILY_DUMP"
fi
find "$DAILY_DIR" -name 'jetbook-*.dump' -type f -mtime "+$DAILY_KEEP_DAYS" -print -delete 2>/dev/null | while IFS= read -r p; do
  log "pruned daily: $p"
done

# --- 4) 附件鏡像（來源唯讀）---------------------------------------------------
if [ -d "$UPLOAD_SRC" ]; then
  rsync -a --delete "$UPLOAD_SRC"/ "$UPLOAD_MIRROR"/
  log "uploads mirrored: $UPLOAD_SRC -> $UPLOAD_MIRROR"
else
  log "WARN: upload src $UPLOAD_SRC missing, skip mirror"
fi

log "done"
