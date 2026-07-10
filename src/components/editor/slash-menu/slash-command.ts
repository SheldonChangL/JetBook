import { Extension, ReactRenderer } from "@tiptap/react";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion from "@tiptap/suggestion";
import { filterSlashMenuItems, SLASH_MENU_ITEMS, type SlashMenuItem } from "./items";
import { SlashMenu, type SlashMenuHandle, type SlashMenuProps } from "./slash-menu";

/**
 * 「/」slash 指令選單 extension（D-03，F-EDIT-02）。
 * - 行首或空白後輸入「/」觸發（suggestion 預設 allowedPrefixes）
 * - 中英文關鍵字即時過濾（filterSlashMenuItems）
 * - 全鍵盤操作：↑↓ 選擇、Enter 插入、Esc 關閉（plugin 內建 dismiss）
 * - IME 相容（ui-design §5.2 第 10 條）：選字（composition）中不觸發選單、
 *   選字中的 Enter／方向鍵不得操作選單
 * - 浮動面板定位交給 plugin 的 managed mount（自動翻轉／捲動跟隨）
 */
export const SlashCommand = Extension.create({
  name: "slashCommand",

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashMenuItem, SlashMenuItem>({
        editor: this.editor,
        pluginKey: new PluginKey("slashCommand"),
        char: "/",
        // IME composition 中不觸發（composition 結束後才依已上屏文字判斷）
        allow: ({ editor }) => editor.isEditable && !editor.view.composing,
        items: ({ query }) => filterSlashMenuItems(SLASH_MENU_ITEMS, query),
        command: ({ editor, range, props }) => props.command({ editor, range }),
        render: () => {
          let component: ReactRenderer<SlashMenuHandle, SlashMenuProps> | null = null;
          let unmount: (() => void) | null = null;

          return {
            onStart: (props) => {
              component = new ReactRenderer(SlashMenu, {
                props: { items: props.items, command: props.command },
                editor: props.editor,
              });
              unmount = props.mount(component.element as HTMLElement);
            },
            onUpdate: (props) => {
              component?.updateProps({ items: props.items, command: props.command });
            },
            onKeyDown: (props) => {
              // IME 選字中的 Enter／方向鍵不得觸發選單行為（keyCode 229＝IME 處理中）
              if (props.event.isComposing || props.event.keyCode === 229) return false;
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
      }),
    ];
  },
});
