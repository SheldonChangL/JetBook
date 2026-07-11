import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { AttachmentNodeView } from "./attachment-node-view";
import type { UploadErrorCode } from "../image/image-upload-utils";

/**
 * 附件節點的上傳設定，由 PageEditor 於 mount 後填入 `editor.storage.attachment`。
 * slash「檔案」項目在指令當下讀取 openPicker（開檔案選擇器）；上傳設定與 image
 * 一致採 storage 傳遞，避免把不穩定 callback 綁進 useEditor。
 */
export interface AttachmentUploadStorage {
  spaceId: string | null;
  pageId: string | null;
  onError: (file: File, code: UploadErrorCode) => void;
  /** 開啟檔案選擇器並在 `pos` 插入上傳結果（由 PageEditor 提供）。 */
  openPicker: (pos: number) => void;
}

declare module "@tiptap/core" {
  interface Storage {
    attachment: AttachmentUploadStorage;
  }
}

/**
 * 附件區塊 extension（D-08，F-EDIT-10）。
 * - 自訂 atom 節點；attrs：attachmentId／fileName／sizeBytes
 * - ReactNodeView 渲染卡片（檔名／大小／下載 href=/api/files/<id>），編輯與閱讀一致
 * - 插入流程：slash「檔案」→ openPicker →/api/upload → 插入節點
 */
export function createAttachmentExtension() {
  return Node.create({
    name: "attachment",
    group: "block",
    atom: true,
    draggable: true,
    selectable: true,

    addStorage(): AttachmentUploadStorage {
      return {
        spaceId: null,
        pageId: null,
        onError: () => {},
        openPicker: () => {},
      };
    },

    addAttributes() {
      return {
        attachmentId: {
          default: null,
          parseHTML: (el) => el.getAttribute("data-attachment-id"),
          renderHTML: (attrs) =>
            attrs.attachmentId ? { "data-attachment-id": attrs.attachmentId as string } : {},
        },
        fileName: {
          default: "",
          parseHTML: (el) => el.getAttribute("data-file-name") ?? "",
          renderHTML: (attrs) => ({ "data-file-name": (attrs.fileName as string) ?? "" }),
        },
        sizeBytes: {
          default: 0,
          parseHTML: (el) => Number(el.getAttribute("data-size-bytes")) || 0,
          renderHTML: (attrs) => ({ "data-size-bytes": String((attrs.sizeBytes as number) ?? 0) }),
        },
      };
    },

    parseHTML() {
      return [{ tag: 'div[data-type="attachment"]' }];
    },

    renderHTML({ HTMLAttributes }) {
      return ["div", mergeAttributes(HTMLAttributes, { "data-type": "attachment" })];
    },

    addNodeView() {
      return ReactNodeViewRenderer(AttachmentNodeView);
    },
  });
}
