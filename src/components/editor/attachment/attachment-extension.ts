import { Node, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { AttachmentNodeView } from "./attachment-node-view";
import { startAttachmentUpload } from "./attachment-upload";
import type { UploadErrorCode } from "../image/image-upload-utils";

/**
 * 拖放檔案的分流：純圖片拖放交給 image extension（內嵌顯示），
 * 含任何非圖片檔則整批由本 plugin 上傳為附件——handleDrop 一次只能由一個
 * plugin 接手，若只取非圖片檔會讓混合拖放中的圖片被靜默丟棄（圖片本就在
 * 附件白名單，當附件卡片處理不遺失任何檔案）。
 * 白名單驗證在 /api/upload 伺服器端，名單外檔案逐檔回報錯誤。
 */
function attachmentDropFiles(list: FileList | null | undefined): File[] {
  if (!list) return [];
  const files = Array.from(list);
  const hasNonImage = files.some((f) => !f.type.startsWith("image/"));
  return hasNonImage ? files : [];
}

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

    // M4-04：拖放非圖片檔即上傳為附件（多檔逐一處理；設定經 storage 傳遞，同 image 模式）
    addProseMirrorPlugins() {
      const { editor } = this;
      return [
        new Plugin({
          key: new PluginKey("attachmentDrop"),
          props: {
            handleDrop(view, event, _slice, moved) {
              if (moved) return false;
              const dragEvent = event as DragEvent;
              const files = attachmentDropFiles(dragEvent.dataTransfer?.files);
              if (files.length === 0) return false;
              const storage = editor.storage.attachment;
              if (!storage.spaceId || !storage.pageId) return false;
              event.preventDefault();
              const dropped = view.posAtCoords({
                left: dragEvent.clientX,
                top: dragEvent.clientY,
              });
              const pos = dropped?.pos ?? view.state.selection.from;
              for (const file of files) {
                startAttachmentUpload({
                  editor,
                  file,
                  pos,
                  spaceId: storage.spaceId,
                  pageId: storage.pageId,
                  onError: storage.onError,
                });
              }
              return true;
            },
          },
        }),
      ];
    },
  });
}
