#!/bin/sh
# JetBook 備份 sidecar 進入點（N-03）
#   - 有參數 → 直接執行（單次備份／還原演練）：
#       docker compose run --rm backup backup.sh
#       docker compose run --rm backup restore-drill.sh
#   - 無參數 → 服務模式：安裝 crontab（每小時觸發）+ 前景 crond。
set -eu

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

CRON_SCHEDULE="${CRON_SCHEDULE:-0 * * * *}"
CRONTAB_FILE=/etc/crontabs/root

# 備份任務輸出導向 pid 1（crond）之 stdout/stderr → docker logs 可見
mkdir -p /etc/crontabs
{
  echo "# JetBook 每小時備份（N-03）；排程由 CRON_SCHEDULE 覆寫"
  echo "$CRON_SCHEDULE /usr/local/bin/backup.sh >> /proc/1/fd/1 2>> /proc/1/fd/2"
} > "$CRONTAB_FILE"

echo "[entrypoint] backup cron installed: '$CRON_SCHEDULE'"

# 啟動即跑一次基準備份，及早暴露連線／權限錯誤（失敗不阻斷服務，交由 cron 重試）
if /usr/local/bin/backup.sh; then
  echo "[entrypoint] initial backup ok"
else
  echo "[entrypoint] WARN: initial backup failed; cron will retry on schedule"
fi

exec crond -f -l 8
