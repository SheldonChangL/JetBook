"use client";

import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { CALLOUT_KINDS, normalizeCalloutKind } from "@/lib/content/callout";
import { CALLOUT_ICONS } from "@/components/content/callout-icons";

/**
 * Callout 節點視圖（D-06，編輯端）：
 * - 左緣 3px 語意色條 + 淡底（樣式見 globals.css .jb-callout，依 data-kind 取 token）。
 * - 前置語意圖示（contentEditable=false，不進內容）。
 * - 右上角 kind 切換工具列：點擊只 updateAttributes({ kind })，不動內容 → 切換不失內容（F-EDIT-08）。
 * - 內文由 NodeViewContent 提供，可放段落/清單等 block。
 */
export function CalloutNodeView({ node, updateAttributes, editor }: NodeViewProps) {
  const t = useTranslations("editor.callout");
  const kind = normalizeCalloutKind(node.attrs.kind);
  const Icon = CALLOUT_ICONS[kind];

  return (
    <NodeViewWrapper className="jb-callout" data-kind={kind}>
      <span className="jb-callout__icon" contentEditable={false} aria-hidden>
        <Icon />
      </span>
      <NodeViewContent className="jb-callout__body" />
      {editor.isEditable ? (
        <span
          className="jb-callout__switch"
          contentEditable={false}
          role="group"
          aria-label={t("switchLabel")}
        >
          {CALLOUT_KINDS.map((k) => {
            const KindIcon = CALLOUT_ICONS[k];
            return (
              <button
                key={k}
                type="button"
                data-kind={k}
                aria-label={t(`kinds.${k}`)}
                aria-pressed={k === kind}
                className={cn("jb-callout__switch-btn", k === kind && "is-active")}
                onClick={() => updateAttributes({ kind: k })}
              >
                <KindIcon className="size-4" aria-hidden />
              </button>
            );
          })}
        </span>
      ) : null}
    </NodeViewWrapper>
  );
}
