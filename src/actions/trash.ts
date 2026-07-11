"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { db } from "@/lib/db";
import { pages, spaces } from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/current";
import { assertCan } from "@/lib/authz/permission";
import { restoreTrashPage } from "@/lib/pages/trash";
import { ipFromHeaders, writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

const restoreSchema = z.object({ pageId: z.uuid() });

/**
 * 還原回收桶頁面（C-08，F-PAGE-06）。薄殼：驗 session → 驗 page.delete（editor+）
 * → 呼叫 lib 還原同批子樹（原父已刪則掛回最上層）→ 寫稽核 → revalidate。
 * 回傳頂節點所屬 space slug 與是否改掛最上層（供 UI 提示）。
 */
export async function restorePage(input: z.infer<typeof restoreSchema>) {
  const { pageId } = restoreSchema.parse(input);
  const page = await db.query.pages.findFirst({ where: eq(pages.id, pageId) });
  if (!page || !page.deletedAt) throw new Error("NOT_FOUND");

  const { user } = await requireSession();
  await assertCan(user, "page.delete", { type: "page", spaceId: page.spaceId });

  const result = await restoreTrashPage({ pageId, userId: user.id });

  logger.info({ userId: user.id, pageId, reparentedToRoot: result.reparentedToRoot }, "page restored");
  await writeAudit({
    actorId: user.id,
    action: "page.restore",
    targetType: "page",
    targetId: pageId,
    metadata: {
      spaceId: result.spaceId,
      title: result.title,
      reparentedToRoot: result.reparentedToRoot,
    },
    ip: ipFromHeaders(await headers()),
  });

  const space = await db.query.spaces.findFirst({ where: eq(spaces.id, result.spaceId) });
  if (space) revalidatePath(`/s/${space.slug}`);
  revalidatePath("/trash");
  return { spaceSlug: space?.slug ?? null, reparentedToRoot: result.reparentedToRoot };
}
