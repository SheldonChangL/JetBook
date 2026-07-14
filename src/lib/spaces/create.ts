import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { spaceMembers, spaces } from "@/lib/db/schema";

/**
 * Space 建立核心（M4-13，issue #218）：web action（actions/space.ts）與
 * API 寫入（lib/api/space-write.ts）共用的唯一建立路徑——slug 自動產生、
 * 建立者自動成為該 space admin，兩件事同一交易完成。
 * 權限（requireSession / API token）與稽核由呼叫端薄殼負責。
 */

function slugifySpaceName(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  // 中文名稱產不出 ASCII slug 時退化為短碼
  return base && /[a-z0-9]/.test(base) ? base.slice(0, 48) : `s-${crypto.randomUUID().slice(0, 8)}`;
}

/** 產生全站唯一 space slug（重名自動加尾碼，不回錯誤——與頁面 slug 策略一致）。 */
export async function uniqueSpaceSlug(name: string): Promise<string> {
  const base = slugifySpaceName(name);
  let candidate = base;
  for (let i = 2; ; i += 1) {
    const existing = await db.query.spaces.findFirst({ where: eq(spaces.slug, candidate) });
    if (!existing) return candidate;
    candidate = `${base}-${i}`;
  }
}

export interface CreateSpaceCoreInput {
  name: string;
  description?: string;
  icon?: string;
}

/** Postgres unique 違反（23505）：uniqueSpaceSlug 為交易外 check-then-insert，並發同名建立可能撞索引。 */
function isUniqueViolation(error: unknown): boolean {
  for (let e = error; e instanceof Error; e = e.cause as Error | undefined) {
    if ((e as { code?: string }).code === "23505") return true;
  }
  return false;
}

/** 建立 space＋建立者成為 admin（同一交易）。回傳完整 space 列。 */
export async function createSpaceCore(
  userId: string,
  input: CreateSpaceCoreInput,
): Promise<typeof spaces.$inferSelect> {
  // 併發同名建立會在 spaces.slug unique 索引撞車（API 面為機器呼叫，機率高於 web）：
  // 重查重試而非直接 500；連撞多次代表異常洪流，放手拋出
  for (let attempt = 0; ; attempt += 1) {
    const slug = await uniqueSpaceSlug(input.name);
    try {
      return await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(spaces)
          .values({ ...input, slug, createdBy: userId })
          .returning();
        if (!created) throw new Error("space 建立失敗");
        await tx.insert(spaceMembers).values({ spaceId: created.id, userId, role: "admin" });
        return created;
      });
    } catch (error) {
      if (isUniqueViolation(error) && attempt < 3) continue;
      throw error;
    }
  }
}
