import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import { listUsers, setUserActive } from "@/lib/admin/users";
import { seedUser } from "./helpers";

/**
 * M4-01 使用者列表搜尋/篩選/分頁整合測試（真 PG）。
 * 整合 DB 為共用資源：所有斷言都以唯一 marker 縮小範圍，不對全表筆數做假設。
 */

describe("listUsers 搜尋/篩選/分頁（M4-01，issue #192）", () => {
  it("以 name 子字串搜尋（不分大小寫）", async () => {
    const marker = `M401Name${randomUUID().slice(0, 8)}`;
    const target = await seedUser({ name: `張三 ${marker}` });
    await seedUser({ name: "李四（不該命中）" });

    const { rows, total } = await listUsers({ query: marker.toLowerCase() });
    expect(total).toBe(1);
    expect(rows.map((r) => r.id)).toEqual([target.id]);
  });

  it("以 email 子字串搜尋", async () => {
    const target = await seedUser();
    // seedUser email 形如 it-<8碼>@test.jetbook；取中段唯一片段查詢
    const fragment = target.email.slice(3, 11);
    const { rows } = await listUsers({ query: fragment });
    expect(rows.some((r) => r.id === target.id)).toBe(true);
    expect(rows.every((r) => r.email.includes(fragment) || r.name.includes(fragment))).toBe(true);
  });

  it("LIKE 萬用字元視為字面值：查『%』不會變成全表命中", async () => {
    const marker = `M401Pct${randomUUID().slice(0, 8)}`;
    const literal = await seedUser({ name: `${marker} 50%折扣` });
    await seedUser({ name: `${marker} 無百分比` });

    const { rows, total } = await listUsers({ query: `${marker} 50%` });
    expect(total).toBe(1);
    expect(rows[0]?.id).toBe(literal.id);
  });

  it("狀態篩選可與搜尋組合", async () => {
    const marker = `M401St${randomUUID().slice(0, 8)}`;
    const active = await seedUser({ name: `${marker} 在職` });
    const inactive = await seedUser({ name: `${marker} 離職` });
    await setUserActive(inactive.id, false);

    const activeResult = await listUsers({ query: marker, status: "active" });
    expect(activeResult.rows.map((r) => r.id)).toEqual([active.id]);

    const inactiveResult = await listUsers({ query: marker, status: "inactive" });
    expect(inactiveResult.rows.map((r) => r.id)).toEqual([inactive.id]);
  });

  it("分頁：total 為過濾後總數，rows 依頁碼切片", async () => {
    const marker = `M401Pg${randomUUID().slice(0, 8)}`;
    const seeded = [];
    for (let i = 0; i < 3; i++) {
      seeded.push(await seedUser({ name: `${marker} 使用者${i}` }));
    }

    const page1 = await listUsers({ query: marker, page: 1, pageSize: 2 });
    expect(page1.total).toBe(3);
    expect(page1.rows).toHaveLength(2);

    const page2 = await listUsers({ query: marker, page: 2, pageSize: 2 });
    expect(page2.total).toBe(3);
    expect(page2.rows).toHaveLength(1);

    const ids = [...page1.rows, ...page2.rows].map((r) => r.id).sort();
    expect(ids).toEqual(seeded.map((u) => u.id).sort());
  });

  it("超出範圍頁碼回空 rows，total 不變", async () => {
    const marker = `M401Ov${randomUUID().slice(0, 8)}`;
    await seedUser({ name: `${marker} 唯一` });
    const { rows, total } = await listUsers({ query: marker, page: 99, pageSize: 10 });
    expect(total).toBe(1);
    expect(rows).toHaveLength(0);
  });
});
