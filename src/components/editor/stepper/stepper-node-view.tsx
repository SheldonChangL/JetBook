"use client";

import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useTranslations } from "next-intl";
import { Plus, X } from "lucide-react";

/**
 * 步驟區塊容器視圖（D-12，編輯端）：
 * - 內文由 NodeViewContent 承載（各 step 的 NodeView 產出 .jb-step，序號走 CSS counter）。
 * - 底部「新增步驟」鈕：於容器末端插入一個空步驟。
 */
export function StepperNodeView({ editor, node, getPos }: NodeViewProps) {
  const t = useTranslations("editor.stepper");

  const addStep = () => {
    if (typeof getPos !== "function") return;
    const base = getPos();
    if (typeof base !== "number") return;
    const at = base + node.nodeSize - 1;
    editor
      .chain()
      .insertContentAt(at, { type: "step", content: [{ type: "paragraph" }] })
      .run();
  };

  return (
    <NodeViewWrapper className="jb-stepper">
      <NodeViewContent className="jb-stepper__steps" />
      {editor.isEditable ? (
        <button
          type="button"
          className="jb-stepper__add"
          contentEditable={false}
          onClick={addStep}
        >
          <Plus className="size-4" aria-hidden />
          <span>{t("addStep")}</span>
        </button>
      ) : null}
    </NodeViewWrapper>
  );
}

/**
 * 單一步驟視圖（D-12，編輯端）：
 * - 序號由 CSS counter（.jb-step::before）產生，不寫入文件。
 * - 內文由 NodeViewContent 承載；右上角「×」刪除本步驟（至少保留一個步驟）。
 */
export function StepNodeView({ editor, getPos }: NodeViewProps) {
  const t = useTranslations("editor.stepper");

  let stepperCount = 1;
  if (typeof getPos === "function") {
    const pos = getPos();
    if (typeof pos === "number") {
      try {
        stepperCount = editor.state.doc.resolve(pos).parent.childCount;
      } catch {
        stepperCount = 1;
      }
    }
  }

  const remove = () => {
    if (typeof getPos !== "function") return;
    const pos = getPos();
    if (typeof pos !== "number") return;
    const stepNode = editor.state.doc.nodeAt(pos);
    if (!stepNode) return;
    if (editor.state.doc.resolve(pos).parent.childCount <= 1) return;
    editor.chain().deleteRange({ from: pos, to: pos + stepNode.nodeSize }).run();
  };

  return (
    <NodeViewWrapper className="jb-step">
      <NodeViewContent className="jb-step__body" />
      {editor.isEditable && stepperCount > 1 ? (
        <button
          type="button"
          className="jb-step__remove"
          contentEditable={false}
          aria-label={t("removeStep")}
          onClick={remove}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      ) : null}
    </NodeViewWrapper>
  );
}
