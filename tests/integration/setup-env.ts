import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inject } from "vitest";

// 在任何測試檔 import lib（env.ts fail-fast）之前，把容器連線注入 process.env。
// NODE_ENV 在 @types/node 型別為 readonly，改以 Object.assign 寫入。
Object.assign(process.env, {
  DATABASE_URL: inject("testDatabaseUrl"),
  BASE_URL: "http://localhost",
  NODE_ENV: "test",
  // 檔案儲存（附件／Zip 匯入）指向暫存目錄，避免污染 repo；未外部指定時才建立。
  UPLOAD_DIR: process.env.UPLOAD_DIR ?? mkdtempSync(join(tmpdir(), "jetbook-it-uploads-")),
});
