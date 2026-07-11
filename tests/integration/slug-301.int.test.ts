import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { pages, pageSlugHistory } from "@/lib/db/schema";
import {
  reclaimSlug,
  recordSlugHistory,
  resolvePageBySlug,
  slugifyTitle,
  uniquePageSlug,
} from "@/lib/pages/slug";
import { seedSpace, seedUser } from "./helpers";

/**
 * C-05 slug 生成與 301 導向整合測試（真 PG，N-01）：
 * slugify 規則、衝突尾碼、含軟刪除頁的唯一性、改名自身排除、
 * slug 歷史 301 解析、歷史撞現行 slug 清理與自癒。
 */

async function insertPage(spaceId: string, slug: string, opts: { deleted?: boolean } = {}) {
  const [page] = await db
    .insert(pages)
    .values({
      spaceId,
      slug,
      title: slug,
      position: "a0",
      deletedAt: opts.deleted ? new Date() : null,
    })
    .returning();
  if (!page) throw new Error("insertPage failed");
  return page;
}

describe("slugifyTitle（標題 → slug/短 ID）", () => {
  it("拉丁字母標題產生可讀 kebab slug", () => {
    expect(slugifyTitle("Getting Started Guide")).toBe("getting-started-guide");
    expect(slugifyTitle("  Hello, World!  ")).toBe("hello-world");
    expect(slugifyTitle("API v2 — Notes")).toBe("api-v2-notes");
  });

  it("純中文或純符號標題 fallback 為 p- 短 ID", () => {
    expect(slugifyTitle("使用指南")).toMatch(/^p-[0-9a-f]{8}$/);
    expect(slugifyTitle("！＠＃")).toMatch(/^p-[0-9a-f]{8}$/);
    expect(slugifyTitle("   ")).toMatch(/^p-[0-9a-f]{8}$/);
  });

  it("中英混合保留拉丁片段", () => {
    expect(slugifyTitle("Roadmap 藍圖 2026")).toBe("roadmap-藍圖-2026");
  });

  it("超長標題截斷至 48 字元", () => {
    const slug = slugifyTitle("a".repeat(100));
    expect(slug).toHaveLength(48);
  });
});

describe("uniquePageSlug（衝突尾碼 + 含軟刪除 + 排除自身）", () => {
  it("無衝突回傳基底 slug", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id);
    expect(await uniquePageSlug(space.id, "Fresh Topic")).toBe("fresh-topic");
  });

  it("與現行頁面衝突時遞增尾碼", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id);
    await insertPage(space.id, "guide");
    expect(await uniquePageSlug(space.id, "Guide")).toBe("guide-2");
    await insertPage(space.id, "guide-2");
    expect(await uniquePageSlug(space.id, "Guide")).toBe("guide-3");
  });

  it("軟刪除頁仍佔用 slug（完整唯一索引，避免還原撞名）", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id);
    await insertPage(space.id, "manual", { deleted: true });
    // 已刪頁仍保留 slug → 新頁必須取尾碼，否則 insert 會違反 ux_pages_space_slug
    expect(await uniquePageSlug(space.id, "Manual")).toBe("manual-2");
  });

  it("改名時排除頁面自身，同義標題不平白產生尾碼", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id);
    const page = await insertPage(space.id, "roadmap");
    // 不排除自身 → 與自己現行 slug 自撞 → roadmap-2（bug 行為）
    expect(await uniquePageSlug(space.id, "Roadmap")).toBe("roadmap-2");
    // 排除自身 → 維持 roadmap
    expect(await uniquePageSlug(space.id, "Roadmap", { excludePageId: page.id })).toBe("roadmap");
  });

  it("slug 唯一性以 space 為界", async () => {
    const owner = await seedUser();
    const spaceA = await seedSpace(owner.id);
    const spaceB = await seedSpace(owner.id);
    await insertPage(spaceA.id, "shared");
    // 另一 space 同名不衝突
    expect(await uniquePageSlug(spaceB.id, "Shared")).toBe("shared");
  });
});

describe("resolvePageBySlug（301 解析）", () => {
  it("現行 slug 直接命中，不導向", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id);
    const page = await insertPage(space.id, "current");
    const res = await resolvePageBySlug(space.id, "current");
    expect(res.page?.id).toBe(page.id);
    expect(res.redirectToSlug).toBeNull();
  });

  it("舊 slug 經歷史表 301 導向現行 slug", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id);
    const page = await insertPage(space.id, "new-name");
    await recordSlugHistory(db, space.id, "old-name", page.id);
    const res = await resolvePageBySlug(space.id, "old-name");
    expect(res.page).toBeNull();
    expect(res.redirectToSlug).toBe("new-name");
  });

  it("未知 slug 回傳雙 null（呼叫端 404）", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id);
    const res = await resolvePageBySlug(space.id, "does-not-exist");
    expect(res.page).toBeNull();
    expect(res.redirectToSlug).toBeNull();
  });

  it("歷史指向的頁面已軟刪除 → 不導向（404）", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id);
    const page = await insertPage(space.id, "gone", { deleted: true });
    await recordSlugHistory(db, space.id, "gone-old", page.id);
    const res = await resolvePageBySlug(space.id, "gone-old");
    expect(res.page).toBeNull();
    expect(res.redirectToSlug).toBeNull();
  });
});

describe("recordSlugHistory 自癒 + reclaimSlug 清理", () => {
  it("同一舊 slug 再次記錄會更新為最新持有者（onConflictDoUpdate）", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id);
    const first = await insertPage(space.id, "first-cur");
    const second = await insertPage(space.id, "second-cur");
    await recordSlugHistory(db, space.id, "shared-old", first.id);
    await recordSlugHistory(db, space.id, "shared-old", second.id);
    // 歷史只保留一筆，指向最後一位持有者
    const rows = await db
      .select()
      .from(pageSlugHistory)
      .where(eq(pageSlugHistory.oldSlug, "shared-old"));
    expect(rows).toHaveLength(1);
    const res = await resolvePageBySlug(space.id, "shared-old");
    expect(res.redirectToSlug).toBe("second-cur");
  });

  it("reclaimSlug 移除同名歷史，避免現行 slug 被陳舊 301 指向他頁", async () => {
    const owner = await seedUser();
    const space = await seedSpace(owner.id);
    const oldOwner = await insertPage(space.id, "old-owner-cur");
    // oldOwner 曾持有 "reclaimed" 後改名 → 歷史 reclaimed → oldOwner
    await recordSlugHistory(db, space.id, "reclaimed", oldOwner.id);
    // 新頁佔用 "reclaimed" 並 reclaim
    const newOwner = await insertPage(space.id, "reclaimed");
    await reclaimSlug(db, space.id, "reclaimed");
    // 解析 "reclaimed" 命中現行 newOwner，而非 301 到 oldOwner
    const res = await resolvePageBySlug(space.id, "reclaimed");
    expect(res.page?.id).toBe(newOwner.id);
    expect(res.redirectToSlug).toBeNull();
    const rows = await db
      .select()
      .from(pageSlugHistory)
      .where(eq(pageSlugHistory.oldSlug, "reclaimed"));
    expect(rows).toHaveLength(0);
  });
});
