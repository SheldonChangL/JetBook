import type { Editor, Range } from "@tiptap/react";
import {
  CircleCheck,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Info,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  OctagonAlert,
  Paperclip,
  Quote,
  Table,
  TriangleAlert,
  Type,
  type LucideIcon,
} from "lucide-react";
import type { CalloutKind } from "@/lib/content/callout";

/**
 * Slash 選單項目定義（D-03，F-EDIT-02）。
 *
 * 可擴充設計：D-04（程式碼強化）、D-05（表格）、D-06（callout）等後續 issue
 * 只需在 SLASH_MENU_ITEMS 追加項目（含 group 分組），選單 UI 與過濾邏輯不必改動。
 * 顯示文案（label/caption）一律走 i18n：`editor.slash.items.<id>.label|desc`；
 * keywords 僅供過濾比對（不顯示），需同時涵蓋中文與英文關鍵字（F-EDIT-02）。
 */

export type SlashMenuGroup = "basic" | "advanced" | "ai";

/** 分組顯示順序（依 ui-design §3.5：基本 → 進階 → AI）。 */
export const SLASH_MENU_GROUP_ORDER: readonly SlashMenuGroup[] = [
  "basic",
  "advanced",
  "ai",
];

export interface SlashMenuItem {
  /** i18n key 後綴：editor.slash.items.<id>.label / .desc */
  id: string;
  group: SlashMenuGroup;
  icon: LucideIcon;
  /** 過濾用關鍵字（中英文皆需涵蓋；小寫比對、substring 命中）。 */
  keywords: readonly string[];
  command: (props: { editor: Editor; range: Range }) => void;
}

/** 依 F-EDIT 優先級排序（C11：標題統一 H1–H3）。 */
export const SLASH_MENU_ITEMS: readonly SlashMenuItem[] = [
  {
    id: "text",
    group: "basic",
    icon: Type,
    keywords: ["文字", "段落", "內文", "text", "paragraph", "plain"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setParagraph().run(),
  },
  {
    id: "heading1",
    group: "basic",
    icon: Heading1,
    keywords: ["標題", "標題1", "大標", "heading", "h1", "title"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run(),
  },
  {
    id: "heading2",
    group: "basic",
    icon: Heading2,
    keywords: ["標題", "標題2", "中標", "heading", "h2", "subtitle"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run(),
  },
  {
    id: "heading3",
    group: "basic",
    icon: Heading3,
    keywords: ["標題", "標題3", "小標", "heading", "h3"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run(),
  },
  {
    id: "bulletList",
    group: "basic",
    icon: List,
    keywords: ["清單", "無序清單", "項目符號", "bullet", "list", "ul", "unordered"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    id: "orderedList",
    group: "basic",
    icon: ListOrdered,
    keywords: ["清單", "有序清單", "編號", "數字", "ordered", "list", "ol", "numbered"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    id: "taskList",
    group: "basic",
    icon: ListTodo,
    keywords: ["清單", "任務清單", "任務", "待辦", "勾選", "todo", "task", "checkbox", "checklist"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    id: "blockquote",
    group: "basic",
    icon: Quote,
    keywords: ["引用", "引述", "quote", "blockquote", "cite"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    id: "divider",
    group: "basic",
    icon: Minus,
    keywords: ["分隔線", "分隔", "水平線", "divider", "hr", "horizontal", "separator", "line"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
  {
    id: "codeBlock",
    group: "advanced",
    icon: Code,
    keywords: ["程式碼", "程式碼區塊", "程式", "代碼", "code", "codeblock", "pre", "snippet"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    id: "table",
    group: "advanced",
    icon: Table,
    keywords: ["表格", "表", "格子", "表列", "table", "grid", "spreadsheet"],
    // D-05（F-EDIT-07）：預設插入 3x3 並含表頭列。
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run(),
  },
  // D-06（F-EDIT-08）：四語意提示區塊。每項插入對應 kind 的 callout（含空段落待輸入）；
  // 插入後仍可於 NodeView 右上角切換 kind 而不失內容。「提示」/「callout」可命中全部四項。
  ...(
    [
      { id: "calloutInfo", kind: "info", icon: Info, keywords: ["提示", "資訊", "訊息", "callout", "info", "hint", "note"] },
      { id: "calloutSuccess", kind: "success", icon: CircleCheck, keywords: ["提示", "成功", "完成", "callout", "success", "hint", "tip"] },
      { id: "calloutWarning", kind: "warning", icon: TriangleAlert, keywords: ["提示", "警告", "注意", "callout", "warning", "warn", "caution", "hint"] },
      { id: "calloutDanger", kind: "danger", icon: OctagonAlert, keywords: ["提示", "危險", "錯誤", "禁止", "callout", "danger", "error", "hint"] },
    ] satisfies { id: string; kind: CalloutKind; icon: LucideIcon; keywords: string[] }[]
  ).map(
    (c): SlashMenuItem => ({
      id: c.id,
      group: "advanced",
      icon: c.icon,
      keywords: c.keywords,
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).setCallout({ kind: c.kind }).run(),
    }),
  ),
  {
    id: "attachment",
    group: "advanced",
    icon: Paperclip,
    keywords: ["檔案", "附件", "附加檔案", "上傳", "下載", "file", "attachment", "attach", "upload"],
    // 先移除觸發字元，再開檔案選擇器（設定與 openPicker 由 PageEditor 填入 storage）
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      editor.storage.attachment.openPicker(editor.state.selection.from);
    },
  },
];

/**
 * 中英文關鍵字過濾（F-EDIT-02：「表格」與 "table" 皆可命中）。
 * 小寫 substring 比對；空 query 回傳全部。
 */
export function filterSlashMenuItems(
  items: readonly SlashMenuItem[],
  query: string,
): SlashMenuItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];
  return items.filter((item) =>
    item.keywords.some((keyword) => keyword.toLowerCase().includes(q)),
  );
}
