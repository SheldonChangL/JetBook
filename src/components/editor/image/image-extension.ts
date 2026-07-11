import Image from "@tiptap/extension-image";
import { ReactNodeViewRenderer } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { ImageNodeView } from "./image-node-view";
import { uploadPlaceholderPlugin } from "./upload-placeholder";
import { startImageUpload } from "./image-upload";
import { getImageFiles, isImageFile, type UploadErrorCode } from "./image-upload-utils";

/**
 * 圖片節點的上傳設定，由 PageEditor 於 mount 後填入 `editor.storage.image`。
 * drop/貼上 plugin 在事件當下讀取，避免把不穩定的 callback 綁進 useEditor。
 */
export interface ImageUploadStorage {
  spaceId: string | null;
  pageId: string | null;
  uploadingLabel: string;
  onError: (file: File, code: UploadErrorCode) => void;
}

declare module "@tiptap/core" {
  interface Storage {
    image: ImageUploadStorage;
  }
}

function readConfig(
  editor: Editor,
): { spaceId: string; pageId: string; uploadingLabel: string; onError: ImageUploadStorage["onError"] } | null {
  const storage = editor.storage.image;
  if (!storage.spaceId || !storage.pageId) return null;
  return {
    spaceId: storage.spaceId,
    pageId: storage.pageId,
    uploadingLabel: storage.uploadingLabel,
    onError: storage.onError,
  };
}

/** 從剪貼簿資料取圖片檔（files 優先，退回 items 取 File；Safari 相容）。 */
function clipboardImageFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  const fromFiles = getImageFiles(data.files);
  if (fromFiles.length > 0) return fromFiles;
  return Array.from(data.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null && isImageFile(file));
}

/**
 * 圖片區塊 extension（D-07，F-EDIT-09）。
 * - drop／貼上圖片檔 → 上傳 /api/upload → 插入 src=/api/files/<id>（含上傳中／失敗提示）
 * - ReactNodeView 提供可編輯 alt／圖說
 * - 安全：HTML 貼上只解析同源 /api/files/ 圖片，外部圖片一律不匯入（預設拒絕）；
 *   不允許 base64 內嵌
 */
export function createImageExtension() {
  return Image.extend({
    addStorage(): ImageUploadStorage {
      return {
        spaceId: null,
        pageId: null,
        uploadingLabel: "",
        onError: () => {},
      };
    },

    parseHTML() {
      return [{ tag: 'img[src^="/api/files/"]' }];
    },

    addNodeView() {
      return ReactNodeViewRenderer(ImageNodeView);
    },

    addProseMirrorPlugins() {
      const editor = this.editor;
      return [
        uploadPlaceholderPlugin(),
        new Plugin({
          key: new PluginKey("imageDropPaste"),
          props: {
            handleDrop(view, event, _slice, moved) {
              // 編輯器內部節點搬移不攔截
              if (moved) return false;
              const dragEvent = event as DragEvent;
              const files = getImageFiles(dragEvent.dataTransfer?.files);
              if (files.length === 0) return false;
              const config = readConfig(editor);
              if (!config) return false;
              event.preventDefault();
              const dropped = view.posAtCoords({
                left: dragEvent.clientX,
                top: dragEvent.clientY,
              });
              const pos = dropped?.pos ?? view.state.selection.from;
              for (const file of files) {
                startImageUpload({ editor, file, pos, ...config });
              }
              return true;
            },
            handlePaste(view, event) {
              const clipboardEvent = event as ClipboardEvent;
              const files = clipboardImageFiles(clipboardEvent.clipboardData);
              if (files.length === 0) return false;
              const config = readConfig(editor);
              if (!config) return false;
              event.preventDefault();
              const pos = view.state.selection.from;
              for (const file of files) {
                startImageUpload({ editor, file, pos, ...config });
              }
              return true;
            },
          },
        }),
      ];
    },
  }).configure({
    inline: false,
    allowBase64: false,
    HTMLAttributes: { class: "content-image" },
  });
}
