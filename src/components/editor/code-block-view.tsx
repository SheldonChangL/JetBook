"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  NodeViewContent,
  NodeViewWrapper,
  type NodeViewProps,
} from "@tiptap/react";
import { Combobox } from "@/components/ui/combobox";
import { CODE_LANGUAGES } from "@/lib/content/lowlight";

/**
 * 程式碼區塊 NodeView（D-04，編輯端）：
 * - 頂列語言下拉（搜尋式，複用 Combobox）；選擇即寫入 node 的 language 屬性。
 * - 左側行號（由 node.textContent 行數推導，隨編輯即時更新）。
 * - 程式碼本身由 CodeBlockLowlight 的 ProseMirror 裝飾即時上色。
 * Esc 跳出邏輯在 extensions.ts 以 keyboard shortcut 實作。
 */
export function CodeBlockView({ node, updateAttributes }: NodeViewProps) {
  const t = useTranslations("editor.codeBlock");
  const rawLanguage = (node.attrs.language as string | null | undefined) ?? null;
  const language = rawLanguage && rawLanguage !== "plaintext" ? rawLanguage : null;

  const options = useMemo(() => [...CODE_LANGUAGES], []);
  const lineCount = useMemo(
    () => Math.max(1, node.textContent.split("\n").length),
    [node.textContent],
  );

  return (
    <NodeViewWrapper className="jb-code">
      <div className="jb-code__bar" contentEditable={false}>
        <Combobox
          options={options}
          value={language}
          onValueChange={(value) => updateAttributes({ language: value })}
          placeholder={t("plainText")}
          searchPlaceholder={t("searchLanguage")}
          emptyText={t("noLanguage")}
          className="h-7 w-48 border-edge"
        />
      </div>
      <div className="jb-code__body">
        <div className="jb-code__gutter" contentEditable={false} aria-hidden>
          {Array.from({ length: lineCount }, (_, i) => (
            <span key={i}>{i + 1}</span>
          ))}
        </div>
        <pre className="jb-code__pre">
          <NodeViewContent<"code"> as="code" />
        </pre>
      </div>
    </NodeViewWrapper>
  );
}
