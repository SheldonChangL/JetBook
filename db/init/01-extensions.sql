-- 於資料庫初始化時安裝必要 extension（僅首次建立 volume 時執行）
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgroonga;
