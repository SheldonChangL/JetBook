"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/**
 * 分頁區塊閱讀端（D-12）：可切換的分頁 client 元件。
 * - 標題列由 server 端傳入（label + 已渲染的內文 content）；client 只負責切換 active。
 * - 與編輯端共用 .jb-tabs / .jb-tabs__panels / .jb-tab-panel 結構與 CSS（data-active + nth-child 控制顯隱）。
 */
export function ContentTabs({
  tabs,
}: {
  tabs: { label: string; content: ReactNode }[];
}) {
  const t = useTranslations("editor.tabs");
  const [active, setActive] = useState(0);
  const current = Math.min(active, Math.max(0, tabs.length - 1));

  return (
    <div className="jb-tabs" data-active={current}>
      <div className="jb-tabs__strip" role="tablist" aria-label={t("tabListLabel")}>
        {tabs.map((tab, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={i === current}
            className={cn("jb-tabs__tab", "jb-tabs__tab--reader", i === current && "is-active")}
            onClick={() => setActive(i)}
          >
            {tab.label || t("defaultLabel", { n: i + 1 })}
          </button>
        ))}
      </div>
      <div className="jb-tabs__panels">
        {tabs.map((tab, i) => (
          <div key={i} role="tabpanel" className="jb-tab-panel">
            {tab.content}
          </div>
        ))}
      </div>
    </div>
  );
}
