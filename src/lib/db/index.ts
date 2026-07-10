import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/lib/env";
import * as schema from "./schema";

/**
 * DB 連線單例。dev 模式下 Next.js HMR 會重複評估模組，
 * 以 globalThis 快取 Pool 避免連線洩漏。
 */
const globalForDb = globalThis as unknown as { jetbookPool?: Pool };

const pool =
  globalForDb.jetbookPool ??
  new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
  });

if (env.NODE_ENV !== "production") {
  globalForDb.jetbookPool = pool;
}

export const db = drizzle(pool, { schema });
export type Db = typeof db;
