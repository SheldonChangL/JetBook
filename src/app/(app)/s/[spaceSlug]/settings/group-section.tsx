import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { SpaceGroupRow } from "@/lib/spaces/manage";
import {
  AddSpaceGroupForm,
  RemoveSpaceGroupButton,
  SpaceGroupRoleSelect,
} from "./group-actions";

/**
 * 群組掛載區塊（K-03 主體泛化 C5）：掛群組＋角色。群組全體成員即以該角色繼承存取權；
 * 成員的個別呈現於上方成員表格以「來源：經由群組」標示。表格 server 端渲染，角色下拉／移除為 client 島。
 */
export async function GroupSection({
  spaceId,
  groups,
  candidates,
}: {
  spaceId: string;
  groups: SpaceGroupRow[];
  candidates: { id: string; name: string }[];
}) {
  const t = await getTranslations("spaceSettings");
  const attachedIds = new Set(groups.map((g) => g.groupId));
  const candidatesNotAttached = candidates.filter((c) => !attachedIds.has(c.id));

  return (
    <section id="groups" aria-labelledby="groups-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="groups-heading" className="text-h4 text-fg">
          {t("groupsHeading")}
        </h2>
        <p className="text-body-ui text-fg-secondary">{t("groupsDesc")}</p>
      </div>

      <AddSpaceGroupForm spaceId={spaceId} candidates={candidatesNotAttached} />

      {groups.length === 0 ? (
        <p className="rounded-md border border-edge bg-raised px-4 py-6 text-center text-body-ui text-fg-tertiary">
          {t("emptyGroups")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-edge">
          <table className="w-full text-body-ui">
            <thead>
              <tr className="border-b border-edge bg-sidebar text-left text-caption text-fg-tertiary">
                <th className="px-3 py-2 font-medium">{t("colGroup")}</th>
                <th className="px-3 py-2 font-medium">{t("colMemberCount")}</th>
                <th className="px-3 py-2 font-medium">{t("colRole")}</th>
                <th className="px-3 py-2 font-medium">{t("colActions")}</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.groupId} className="border-b border-edge last:border-b-0">
                  <td className="px-3 py-2 font-medium text-fg">
                    <Link href={`/admin/groups/${g.groupId}`} className="hover:text-primary">
                      {g.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-fg-secondary">
                    {t("groupMemberCount", { count: g.memberCount })}
                  </td>
                  <td className="px-3 py-2">
                    <SpaceGroupRoleSelect spaceId={spaceId} groupId={g.groupId} role={g.role} />
                  </td>
                  <td className="px-3 py-2">
                    <RemoveSpaceGroupButton spaceId={spaceId} groupId={g.groupId} name={g.name} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
