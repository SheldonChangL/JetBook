import { inject } from "vitest";

// 在任何測試檔 import lib（env.ts fail-fast）之前，把容器連線注入 process.env。
// NODE_ENV 在 @types/node 型別為 readonly，改以 Object.assign 寫入。
Object.assign(process.env, {
  DATABASE_URL: inject("testDatabaseUrl"),
  BASE_URL: "http://localhost",
  NODE_ENV: "test",
});
