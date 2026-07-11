import { ReactRenderer } from "@tiptap/react";
import { PluginKey } from "@tiptap/pm/state";
import type { MentionNodeAttrs } from "@tiptap/extension-mention";
import type { SuggestionOptions } from "@tiptap/suggestion";
import { MentionList, type MentionItem, type MentionListHandle, type MentionListProps } from "./mention-list";

/**
 * 建立 @mention／頁面連結共用的 suggestion 設定（D-11）。
 *
 * 沿用 slash 選單的 managed mount（ReactRenderer + plugin.mount，自動翻轉／捲動跟隨）。
 * IME 相容（ui-design §5.2）：composition 中不觸發（allow 檢查 editor.view.composing）、
 * 選字中的 Enter／方向鍵不得操作選單（onKeyDown 過濾 keyCode 229 與 isComposing）。
 * 保留 extension-mention 預設 command（插入節點 + 尾隨空白），僅覆寫 char/items/render/allow。
 */
export function createMentionSuggestion(config: {
  char: string;
  nodeName: string;
  kind: MentionListProps["kind"];
  fetchItems: (query: string) => Promise<MentionItem[]>;
}): Omit<SuggestionOptions<MentionItem, MentionNodeAttrs>, "editor"> {
  return {
    char: config.char,
    pluginKey: new PluginKey(`mentionSuggestion:${config.nodeName}`),
    // 可編輯且非 IME 選字中，且該位置容許插入此 inline 節點時才觸發（預設拒絕）。
    allow: ({ editor, state, range }) => {
      if (!editor.isEditable || editor.view.composing) return false;
      const $from = state.doc.resolve(range.from);
      const type = state.schema.nodes[config.nodeName];
      if (!type) return false;
      return Boolean($from.parent.type.contentMatch.matchType(type));
    },
    items: ({ query }) => config.fetchItems(query),
    render: () => {
      let component: ReactRenderer<MentionListHandle, MentionListProps> | null = null;
      let unmount: (() => void) | null = null;

      return {
        onStart: (props) => {
          component = new ReactRenderer(MentionList, {
            props: { items: props.items, command: props.command, kind: config.kind },
            editor: props.editor,
          });
          unmount = props.mount?.(component.element as HTMLElement) ?? null;
        },
        onUpdate: (props) => {
          component?.updateProps({ items: props.items, command: props.command, kind: config.kind });
        },
        onKeyDown: (props) => {
          // IME 選字中的 Enter／方向鍵不得觸發選單行為（keyCode 229＝IME 處理中）。
          if (props.event.isComposing || props.event.keyCode === 229) return false;
          if (props.event.key === "Escape") return false;
          return component?.ref?.onKeyDown(props.event) ?? false;
        },
        onExit: () => {
          unmount?.();
          unmount = null;
          component?.destroy();
          component = null;
        },
      };
    },
  };
}
