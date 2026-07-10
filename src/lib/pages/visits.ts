import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { pageVisits } from "@/lib/db/schema";

/** 記錄最近瀏覽（G9；upsert 更新時間，Dashboard「繼續閱讀」來源）。 */
export async function recordVisit(userId: string, pageId: string): Promise<void> {
  await db
    .insert(pageVisits)
    .values({ userId, pageId })
    .onConflictDoUpdate({
      target: [pageVisits.userId, pageVisits.pageId],
      set: { visitedAt: sql`now()` },
    });
}
