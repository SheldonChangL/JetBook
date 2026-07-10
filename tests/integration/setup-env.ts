import { inject } from "vitest";

// 在任何測試檔 import lib（env.ts fail-fast）之前，把容器連線注入 process.env。
process.env.DATABASE_URL = inject("testDatabaseUrl");
process.env.BASE_URL = "http://localhost";
process.env.NODE_ENV = "test";
