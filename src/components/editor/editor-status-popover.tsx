"use client";

import { ChevronDown, FileCheck2, LockKeyhole, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface EditorStatusPopoverProps {
  lockLost: boolean;
  versionNo: number;
  aiEnabled: boolean;
}

/** 將低頻鎖定、版本與 AI 說明收進可關閉、可復原焦點的情境層。 */
export function EditorStatusPopover({ lockLost, versionNo, aiEnabled }: EditorStatusPopoverProps) {
  const t = useTranslations("editor");

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="archive-editor-status-trigger">
          <FileCheck2 aria-hidden className="archive-editor-status-icon" />
          <span>{t("archiveDocumentStatus")}</span>
          <ChevronDown aria-hidden className="archive-editor-status-chevron" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="archive-editor-status-popover">
        <div className="archive-editor-status-head">
          <div>
            <p>{t("archiveKicker")}</p>
            <strong>{t("archiveDocumentStatus")}</strong>
          </div>
          <Badge variant={lockLost ? "warning" : "success"}>
            {lockLost ? t("archiveReadOnly") : t("archiveConnected")}
          </Badge>
        </div>

        <div className="archive-editor-lock-card" data-state={lockLost ? "lost" : "held"}>
          <LockKeyhole aria-hidden className="size-4" />
          <div>
            <strong>{lockLost ? t("archiveLockLost") : t("archiveLockHeld")}</strong>
            <p>{lockLost ? t("archiveLockLostDetail") : t("archiveLockDetail")}</p>
          </div>
        </div>

        <dl className="archive-editor-facts">
          <div>
            <dt>{t("archiveVersion")}</dt>
            <dd>{t("archiveVersionValue", { version: versionNo })}</dd>
          </div>
          <div>
            <dt>{t("archiveAutosave")}</dt>
            <dd>{t("archiveAutosaveDetail")}</dd>
          </div>
        </dl>

        <div className="archive-editor-status-note">
          <Sparkles aria-hidden />
          <p>{aiEnabled && !lockLost ? t("archiveAiEnabled") : t("archiveAiUnavailable")}</p>
        </div>
        <p className="archive-editor-protection-note">{t("archiveProtectionHint")}</p>
      </PopoverContent>
    </Popover>
  );
}
