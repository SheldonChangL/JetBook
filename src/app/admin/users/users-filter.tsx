"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui";

const ALL = "all";

/** 組出 /admin/users 的過濾 URL；條件變更即回到第 1 頁（不帶 page 參數）。 */
function toUsersUrl(query: string, status: string): string {
  const params = new URLSearchParams();
  const q = query.trim();
  if (q) params.set("q", q);
  if (status !== ALL) params.set("status", status);
  const qs = params.toString();
  return qs ? `/admin/users?${qs}` : "/admin/users";
}

export interface UsersFilterLabels {
  searchPlaceholder: string;
  statusLabel: string;
  statusAll: string;
  statusActive: string;
  statusInactive: string;
}

/** 使用者列表搜尋/狀態過濾（M4-01）：輸入停止 350ms 後更新 URL，由 server 重查。 */
export function UsersFilter({
  initialQuery,
  status,
  labels,
}: {
  initialQuery: string;
  status: string;
  labels: UsersFilterLabels;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);

  // 導航後 server 回帶最新 query 時同步 state（同 search 頁模式）。
  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    if (query === initialQuery) return;
    const id = setTimeout(() => {
      router.replace(toUsersUrl(query, status));
    }, 350);
    return () => clearTimeout(id);
  }, [query, initialQuery, status, router]);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="min-w-64 flex-1">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={labels.searchPlaceholder}
          aria-label={labels.searchPlaceholder}
        />
      </div>
      <Select
        value={status}
        onValueChange={(value) => router.replace(toUsersUrl(query, value))}
      >
        <SelectTrigger className="w-36" aria-label={labels.statusLabel}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{labels.statusAll}</SelectItem>
          <SelectItem value="active">{labels.statusActive}</SelectItem>
          <SelectItem value="inactive">{labels.statusInactive}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
