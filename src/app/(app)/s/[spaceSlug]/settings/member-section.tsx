import { getTranslations } from "next-intl/server";
import type {
  CandidateUser,
  SpaceGroupMemberRow,
  SpaceMemberRow,
} from "@/lib/spaces/manage";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { AddMemberForm, MemberRoleSelect, RemoveMemberButton } from "./member-actions";

const ROLE_LABEL_KEY: Record<SpaceGroupMemberRow["role"], string> = {
  admin: "roleAdmin",
  editor: "roleEditor",
  commenter: "roleCommenter",
  viewer: "roleViewer",
};

/**
 * 成員與權限區塊（設計規範 §3.10）：邀請列＋成員表格。表格於 server 端渲染，
 * 角色下拉、移除、加入為 client 互動島（避免 Date 跨界與時區 hydration 落差）。
 * 經群組繼承的成員（K-03）以「來源：經由群組」badge 標示，角色唯讀（於群組層管理）。
 */
export async function MemberSection({
  spaceId,
  currentUserId,
  members,
  groupMembers,
  candidates,
}: {
  spaceId: string;
  currentUserId: string;
  members: SpaceMemberRow[];
  groupMembers: SpaceGroupMemberRow[];
  candidates: CandidateUser[];
}) {
  const t = await getTranslations("spaceSettings");
  const adminCount = members.filter((m) => m.role === "admin").length;
  const memberIds = new Set(members.map((m) => m.userId));
  const candidatesNotMembers = candidates.filter((c) => !memberIds.has(c.id));
  const dateFormat = new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium" });
  const hasAnyMember = members.length > 0 || groupMembers.length > 0;

  return (
    <section id="members" aria-labelledby="members-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="members-heading" className="text-h4 text-fg">
          {t("membersHeading")}
        </h2>
        <p className="text-body-ui text-fg-secondary">{t("membersDesc")}</p>
      </div>

      <AddMemberForm spaceId={spaceId} candidates={candidatesNotMembers} />

      {!hasAnyMember ? (
        <p className="rounded-md border border-edge bg-raised px-4 py-6 text-center text-body-ui text-fg-tertiary">
          {t("emptyMembers")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-edge">
          <table className="w-full text-body-ui">
            <thead>
              <tr className="border-b border-edge bg-sidebar text-left text-caption text-fg-tertiary">
                <th className="px-3 py-2 font-medium">{t("colMember")}</th>
                <th className="px-3 py-2 font-medium">{t("colSource")}</th>
                <th className="px-3 py-2 font-medium">{t("colRole")}</th>
                <th className="px-3 py-2 font-medium">{t("colJoinedAt")}</th>
                <th className="px-3 py-2 font-medium">{t("colActions")}</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const isLastAdmin = adminCount === 1 && m.role === "admin";
                return (
                  <tr key={m.userId} className="border-b border-edge last:border-b-0">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-3">
                        <Avatar name={m.name} colorKey={m.userId} size="md" />
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate font-medium text-fg">{m.name}</span>
                          <span className="truncate text-caption text-fg-tertiary">{m.email}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="neutral">{t("sourceDirect")}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      <MemberRoleSelect
                        spaceId={spaceId}
                        userId={m.userId}
                        role={m.role}
                        isLastAdmin={isLastAdmin}
                        isSelf={m.userId === currentUserId}
                      />
                    </td>
                    <td className="px-3 py-2 text-fg-secondary">{dateFormat.format(m.createdAt)}</td>
                    <td className="px-3 py-2">
                      <RemoveMemberButton
                        spaceId={spaceId}
                        userId={m.userId}
                        name={m.name}
                        isLastAdmin={isLastAdmin}
                      />
                    </td>
                  </tr>
                );
              })}
              {groupMembers.map((m) => (
                <tr key={`g-${m.userId}`} className="border-b border-edge last:border-b-0">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-3">
                      <Avatar name={m.name} colorKey={m.userId} size="md" />
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate font-medium text-fg">{m.name}</span>
                        <span className="truncate text-caption text-fg-tertiary">{m.email}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <Tooltip content={t("sourceGroupTooltip", { groups: m.groupNames.join("、") })}>
                      <span className="inline-block">
                        <Badge variant="primary">{t("sourceGroup")}</Badge>
                      </span>
                    </Tooltip>
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant="neutral">{t(ROLE_LABEL_KEY[m.role])}</Badge>
                  </td>
                  <td className="px-3 py-2 text-fg-tertiary">—</td>
                  <td className="px-3 py-2 text-fg-tertiary">—</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
