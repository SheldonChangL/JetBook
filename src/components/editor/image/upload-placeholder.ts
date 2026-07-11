import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * 圖片上傳中的佔位 decoration plugin（D-07）。
 *
 * 上傳中的圖片以 widget decoration 呈現（預覽縮圖 + 轉圈 + 上傳中字樣），
 * **不進文件節點**——因此不會被 autosave 存進 canonical JSON，也不會被序列化
 * 進 content_md／content_text；上傳成功後才把真正的 image 節點插入文件。
 * 佔位位置隨後續編輯自動 map，成功時取回目前位置再插入。
 */

export const uploadPlaceholderKey = new PluginKey<DecorationSet>("imageUploadPlaceholder");

interface AddPlaceholder {
  add: { id: symbol; pos: number; previewUrl: string; label: string };
}
interface RemovePlaceholder {
  remove: { id: symbol };
}
type PlaceholderMeta = AddPlaceholder | RemovePlaceholder;

function buildPlaceholder(previewUrl: string, label: string): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "image-upload-placeholder";
  wrapper.setAttribute("role", "status");

  const img = document.createElement("img");
  img.src = previewUrl;
  img.alt = "";
  img.draggable = false;

  const status = document.createElement("div");
  status.className = "image-upload-placeholder__status";

  const spinner = document.createElement("span");
  spinner.className = "image-upload-placeholder__spinner";
  spinner.setAttribute("aria-hidden", "true");

  const text = document.createElement("span");
  text.textContent = label;

  status.append(spinner, text);
  wrapper.append(img, status);
  return wrapper;
}

/** 建立佔位 plugin（每個編輯器實例一份）。 */
export function uploadPlaceholderPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: uploadPlaceholderKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set) {
        let next = set.map(tr.mapping, tr.doc);
        const meta = tr.getMeta(uploadPlaceholderKey) as PlaceholderMeta | undefined;
        if (meta && "add" in meta) {
          const { id, pos, previewUrl, label } = meta.add;
          const deco = Decoration.widget(pos, buildPlaceholder(previewUrl, label), {
            id,
            side: -1,
          });
          next = next.add(tr.doc, [deco]);
        } else if (meta && "remove" in meta) {
          const target = next.find(undefined, undefined, (spec) => spec.id === meta.remove.id);
          next = next.remove(target);
        }
        return next;
      },
    },
    props: {
      decorations(state) {
        return this.getState(state);
      },
    },
  });
}

/**
 * 取回指定佔位目前的文件位置；找不到（使用者已刪除／復原）回 null，
 * 呼叫端據此決定是否放棄插入。
 */
export function findImagePlaceholder(state: EditorState, id: symbol): number | null {
  const set = uploadPlaceholderKey.getState(state);
  if (!set) return null;
  const [first] = set.find(undefined, undefined, (spec) => spec.id === id);
  return first ? first.from : null;
}
