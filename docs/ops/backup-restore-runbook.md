# JetBook 備份與還原 Runbook（N-03）

> 對象：維運／SRE。涵蓋備份機制、災難還原步驟、DB 與附件時間差視窗聲明、季度演練清單，以及與 NFR 原文（WAL 歸檔）的取捨與升級路徑。
>
> 對應需求：`docs/specs/non-functional-requirements.md` A.5（NFR-DATA-01~05）、`docs/specs/functional-requirements.md` F-IE-05。

## 1. 機制總覽

備份由 `docker-compose.yml` 的 **`backup` sidecar 服務**負責（image 定義於 `backup/`）：

| 項目 | 內容 |
|---|---|
| Base image | `postgres:16-alpine`（pg_dump/pg_restore/psql 主版本與 `db`＝PG16 一致）＋ busybox `crond` ＋ `rsync` |
| DB 備份 | 每小時 `pg_dump -Fc --no-owner --no-acl` 全庫邏輯備份（custom format） |
| 小時保留 | 最新 **48 份**（＝覆蓋 48 小時；`BACKUP_HOURLY_KEEP` 可調） |
| 每日晉升 | 每日第一次備份複製一份到 `daily/`，保留 **30 天**（`BACKUP_DAILY_KEEP_DAYS` 可調） |
| 附件備份 | 每次備份週期 `rsync -a --delete` 鏡像 `uploads` volume（來源**唯讀**掛載） |
| 排程 | 預設 `0 * * * *`（每小時整點；`BACKUP_CRON_SCHEDULE` 可調） |
| 存放 | `backups` named volume；容器內路徑 `/backups` |

備份目錄結構（`backups` volume 內）：

```
/backups
├── db/
│   ├── hourly/   jetbook-YYYYMMDDThhmmssZ.dump   （最新 48 份）
│   └── daily/    jetbook-YYYY-MM-DD.dump          （保留 30 天）
└── uploads/      （附件 volume 的完整鏡像）
```

啟動行為：sidecar 啟動時先跑一次基準備份（及早暴露連線／權限錯誤），之後交由 `crond` 每小時觸發。備份任務輸出導向容器 stdout，可用 `docker compose logs backup` 檢視。

## 2. RPO / RTO 與 NFR 取捨聲明

**NFR 原文（NFR-DATA-01/03）**：`pg_dump 每日全備 + WAL archiving 連續歸檔`、`WAL 保留 7 天`。

**本實作（M1 落地）**：以**每小時邏輯全備**（`pg_dump -Fc`）取代「每日全備＋WAL 連續歸檔」，達成 **RPO ≤ 1h**（NFR-DATA-01）。

**取捨理由**：

- JetBook 為內部知識庫，資料量小、寫入頻率低。此規模下每小時整庫 `pg_dump` 成本可忽略（秒級、數 MB），即可把最壞資料遺失窗口壓到 1 小時內，直接滿足 RPO ≤ 1h，且**還原路徑最簡單、最可靠**（單一 `pg_restore`，無需 base backup + WAL replay 串接與 recovery target 設定）。
- WAL 連續歸檔的價值在於「接近零 RPO」與「任意時間點還原（PITR）」；對本專案的 RPO 目標（1h）而言，WAL 帶來的額外複雜度（`archive_command`、WAL 空間管理、還原時的 recovery 設定與失敗面）**投報不成比例**。
- 因此本階段以高頻邏輯備份達標，**不啟用 WAL 歸檔**。此為明確、有意識的取捨，非疏漏。

**升級路徑（資料量成長時）**：當單庫成長到 `pg_dump`／`pg_restore` 時間逼近 RTO 預算，或需求收緊到「近零 RPO / PITR」時，改採**物理備份 + WAL 歸檔**：

1. 啟用 `wal_level=replica`（或 `logical`）、設定 `archive_mode=on` 與 `archive_command`（歸檔至異機／物件儲存）。
2. 以 `pg_basebackup -Ft -X stream` 取每日（或每週）base backup。
3. 還原改為：還原 base backup → 設定 `restore_command` 與 `recovery_target_time` → replay WAL 至目標時間點。
4. 保留本 runbook 的邏輯 dump 作為第二層防護（防邏輯損毀／誤刪的快速回溯）。

此升級不需要改動應用程式碼，僅為 `db` 服務設定與 `backup` sidecar 腳本的變更。

**RTO ≤ 4h（NFR-DATA-02）**：本方案還原路徑為「重建容器 + `pg_restore` + 附件 volume 複製」。小庫情境下三者皆為分鐘級，遠在 4 小時預算內。實際 RTO 以每季演練（§5）量測值為準。

## 3. DB 與附件時間差視窗聲明（NFR-DATA-03 要求）

DB dump 與附件鏡像**在同一備份週期內循序執行**（先 `pg_dump`，後 `rsync`），兩者間隔僅為單次 `pg_dump` 的執行時間（小庫為秒級）。但兩者**並非單一原子快照**，因此存在一個可接受的不一致視窗：

- **可接受範圍**：以「附件鏡像可能比 DB dump 新最多一個備份週期（預設 1 小時）」為上界聲明。實務上同週期內僅相差數秒。
- **不一致的方向與後果**：
  - **附件比 DB 新**（DB dump 先完成、其後到 rsync 前有新上傳）：還原後 DB 可能引用到「該筆附件的 metadata 尚未入庫」的檔案 → 表現為 `uploads/` 有孤兒檔案。無使用者可見錯誤；由既有附件 GC job（F-ADMIN-07）於寬限期後清除。
  - **DB 比附件新**（極少見，僅當附件在 dump 後被刪除又於 rsync 前）：DB 引用到鏡像中已存在的檔案，無影響。
- **不會發生**的情況：DB 引用一個附件、但鏡像中缺該檔案的「可見破圖」——因為附件寫入管線是「先落磁碟、後寫 DB metadata」，且 rsync 在 dump 之後執行，鏡像只會多不會少。
- 若需要嚴格一致，升級路徑（§2）的 WAL/PITR 搭配附件版本化物件儲存可進一步收斂此視窗；M1 階段以上述可接受範圍運作。

## 4. 災難還原步驟（完整）

> 前提：已取得備份存放區（`backups` volume 或其異機副本），以及 repo 與 `.env`（含正確的 `POSTGRES_*`）。

### 4.1 全站還原（乾淨環境）

1. **準備環境**：安裝 Docker / Docker Compose，取得 repo 與 `.env`。將備份資料放回 `backups` volume（見 §6 異機保存的回取方式）。

2. **只起 DB**（不要先起 web/worker，避免對半還原的庫寫入）：
   ```bash
   docker compose up -d db
   docker compose exec db pg_isready -U "$POSTGRES_USER"   # 等待 healthy
   ```

3. **確認要還原的 dump**（挑選時間點）：
   ```bash
   docker compose run --rm --entrypoint sh backup -c 'ls -1t /backups/db/hourly/ /backups/db/daily/'
   ```

4. **還原 DB**（custom format，平行還原加速）：
   ```bash
   # 還原到既有（空）jetbook 庫；若 db 為全新初始化，POSTGRES_DB 已自動建好空庫
   docker compose run --rm --entrypoint sh backup -c '
     DUMP=$(ls -1t /backups/db/hourly/jetbook-*.dump | head -1);
     echo "restoring $DUMP";
     pg_restore --no-owner --no-acl -j 2 -d "$PGDATABASE" "$DUMP"'
   ```
   > 若還原到「已有資料」的庫，先重建乾淨庫：
   > `docker compose run --rm --entrypoint sh backup -c 'psql -d postgres -c "DROP DATABASE IF EXISTS $PGDATABASE;" -c "CREATE DATABASE $PGDATABASE;"'`
   > 再執行上述 `pg_restore`。

5. **還原附件**：把鏡像複製回 `uploads` volume：
   ```bash
   docker compose run --rm --entrypoint sh backup -c 'rsync -a /backups/uploads/ /data/uploads/'
   ```
   > 註：此指令需 `uploads` 為可寫掛載。sidecar 平時以唯讀掛 `uploads`；**還原時**臨時改掛可寫（移除 `:ro`）再執行，或改用一個可寫掛載 `uploads` 的一次性容器執行同一 rsync。還原完成後改回唯讀。

6. **啟動全服務並驗證**：
   ```bash
   docker compose up -d
   docker compose ps
   curl -fsS http://127.0.0.1:${HTTP_PORT:-80}/api/readyz
   ```
   登入（種子 admin）抽查數筆頁面與附件可正常開啟。

### 4.2 僅還原附件 / 僅還原 DB

- 僅 DB：執行 4.1 步驟 2–4。
- 僅附件：執行 4.1 步驟 5。

## 5. 季度還原演練清單（NFR-DATA-04）

每季至少一次，於**非正式環境**執行，並記錄結果（日期、執行人、量測 RTO、PASS/FAIL、異常）。

- [ ] 確認 `backup` sidecar 近 48h 有連續小時備份、`daily/` 有連續日備（`docker compose logs backup` 無 ERROR）。
- [ ] 執行自動化還原演練（restore 到臨時 scratch DB，比對表數與 users 筆數）：
  ```bash
  docker compose run --rm backup restore-drill.sh
  # 期望輸出：RESULT: PASS (tables=<n>, users=<m> match source)
  ```
- [ ] 抽測一份**每日**備份亦可還原（指定 dump）：
  ```bash
  docker compose run --rm backup restore-drill.sh /backups/db/daily/jetbook-YYYY-MM-DD.dump
  ```
- [ ] 附件鏡像抽測：隨機挑數個檔案比對 `uploads` 與 `/backups/uploads` 的 checksum 一致。
- [ ] 量測並記錄本次「重建 + 還原」實際耗時，確認 ≤ RTO 4h。
- [ ] 驗證異機副本（§6）可正常回取。
- [ ] 記錄演練結果並歸檔（含任何缺口與後續行動）。

## 6. 異機保存（NFR-DATA-03：不同實體主機）

`backups` named volume 為**單機基準**。正式環境必須把備份放到**不同實體主機**，擇一：

- 將 `backups` volume 綁定至掛載於他機的儲存（NFS／SMB／雲端 block storage）。
- 追加一個排程工作，把 `/backups` 以 `rsync`／`restic` 增量推送到異機或物件儲存（S3/MinIO），並在異機保留備份。
- 物件儲存側開啟版本化與生命週期規則，落實 30 天／7 天保留於異機。

回取：把異機副本同步回本機 `backups` volume 後，依 §4 還原。

## 7. 設定與可調參數

`.env`（皆選填，未設用預設）：

| 變數 | 預設 | 說明 |
|---|---|---|
| `BACKUP_HOURLY_KEEP` | `48` | 小時備份保留份數 |
| `BACKUP_DAILY_KEEP_DAYS` | `30` | 每日備份保留天數 |
| `BACKUP_CRON_SCHEDULE` | `0 * * * *` | 備份 cron 排程 |

DB 連線（`PGHOST/PGUSER/PGPASSWORD/PGDATABASE`）由 compose 依 `POSTGRES_*` 自動注入。

## 8. 安全備註

- sidecar 對 `uploads` 以**唯讀**掛載，備份程序不可寫壞正式附件。
- 備份 dump 含全庫資料（含 `sessions`、`password_reset_tokens` 等敏感表的 hash 值），`backups` 存放區須比照正式資料庫的存取控管；異機副本傳輸須加密（TLS／SSH），靜態加密由儲存層負責。
- 憑證只經 `.env`／compose 注入，不寫入 image 與備份檔名。
