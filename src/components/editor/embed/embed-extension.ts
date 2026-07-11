import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { EMBED_NODE_NAME, normalizeEmbedUrl } from "@/lib/content/embed";
import { EmbedNodeView } from "./embed-node-view";

/**
 * Embed 嵌入節點（D-14，F-EDIT-15）。
 * - 自訂 atom block 節點，`attrs.url` 為嵌入來源 URL（canonical 存於文件 JSON）。
 * - 「iframe 嵌入 vs 連結卡片」不存入文件，一律於渲染當下依白名單推導（見 lib/content/embed.ts）。
 *   白名單以逗號分隔存於 env `EMBED_ALLOWED_DOMAINS`，由 PageEditor 填入 `editor.storage.embed.allowedDomains`
 *   供 NodeView 即時判斷（12-factor：白名單即部署設定，禁 migration 新增 org_settings 欄）。
 *
 * R1 降險：以 TipTap `Node.create` 標準 API 定義節點與指令，零自研 ProseMirror plugin。
 */
export interface EmbedOptions {
  HTMLAttributes: Record<string, unknown>;
}

interface EmbedAttrs {
  url?: string;
}

/** 白名單設定，由 PageEditor 於 mount 後填入 `editor.storage.embed`；NodeView 於渲染當下讀取。 */
export interface EmbedStorage {
  allowedDomains: string[];
}

declare module "@tiptap/core" {
  interface Storage {
    embed: EmbedStorage;
  }
  interface Commands<ReturnType> {
    embed: {
      /** 於游標處插入 Embed 區塊（預設空 URL，於 NodeView 貼上網址）。 */
      setEmbed: (attrs?: EmbedAttrs) => ReturnType;
    };
  }
}

export const Embed = Node.create<EmbedOptions>({
  name: EMBED_NODE_NAME,
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addStorage(): EmbedStorage {
    return { allowedDomains: [] };
  },

  addAttributes() {
    return {
      url: {
        default: "",
        parseHTML: (element) => normalizeEmbedUrl(element.getAttribute("data-url")),
        renderHTML: (attributes) => ({
          "data-url": normalizeEmbedUrl((attributes as EmbedAttrs).url),
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-embed]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-embed": "",
        class: "jb-embed",
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(EmbedNodeView);
  },

  addCommands() {
    return {
      setEmbed:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { url: normalizeEmbedUrl(attrs?.url) },
          }),
    };
  },
});
