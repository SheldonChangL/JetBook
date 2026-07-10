import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import type { TestProject } from "vitest/node";

/**
 * 整合測試全域設定（N-01）：
 * 1. 以正式環境同一份 db/Dockerfile 建 test image（pgroonga + pgvector 一致，A-10 指引）
 * 2. testcontainers 起 PG 容器
 * 3. 套用全部 drizzle migrations
 * 4. 以 provide 傳遞連線字串給測試 worker（setup-env.ts 注入 process.env）
 */

let container: StartedPostgreSqlContainer | undefined;

export async function setup(project: TestProject) {
  const root = resolve(__dirname, "../..");
  execSync("docker build -q -t jetbook-db:test ./db", { cwd: root, stdio: "pipe" });

  container = await new PostgreSqlContainer("jetbook-db:test")
    .withDatabase("jetbook_test")
    .withUsername("test")
    .withPassword("test")
    .start();

  // testcontainers 回傳 postgres:// 前綴；env schema 統一要求 postgresql://
  const url = container.getConnectionUri().replace(/^postgres:\/\//, "postgresql://");
  const pool = new Pool({ connectionString: url });
  await migrate(drizzle(pool), { migrationsFolder: resolve(root, "drizzle") });
  await pool.end();

  project.provide("testDatabaseUrl", url);
}

export async function teardown() {
  await container?.stop();
}

declare module "vitest" {
  export interface ProvidedContext {
    testDatabaseUrl: string;
  }
}
