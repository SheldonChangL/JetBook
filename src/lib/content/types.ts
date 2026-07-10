/** TipTap/ProseMirror 文件節點的最小型別（canonical 格式，ADR-002）。 */
export interface ProseMirrorMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface ProseMirrorNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: ProseMirrorNode[];
  marks?: ProseMirrorMark[];
  text?: string;
}

export interface ProseMirrorDoc {
  type: "doc";
  content?: ProseMirrorNode[];
}

/** 空文件（新頁面初始內容）。 */
export const EMPTY_DOC: ProseMirrorDoc = { type: "doc", content: [] };
