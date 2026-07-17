import { createHeadingSlugger, headingNodeText } from "./heading-slug";
import type { ProseMirrorDoc, ProseMirrorNode } from "./types";

export interface TableOfContentsItem {
  id: string;
  level: 2 | 3;
  text: string;
}

/**
 * Collect the reader's H2/H3 outline in the same depth-first order and with the
 * same slugger used by RenderContent. Nested headings inside details/tabs/steps
 * therefore resolve to the exact anchors rendered in the document.
 */
export function collectTableOfContents(doc: ProseMirrorDoc | null): TableOfContentsItem[] {
  if (!doc?.content?.length) return [];
  const slug = createHeadingSlugger();
  const items: TableOfContentsItem[] = [];

  function visit(node: ProseMirrorNode) {
    if (node.type === "heading") {
      const rawLevel = Number(node.attrs?.level ?? 1);
      const level = Math.min(Math.max(rawLevel, 1), 3);
      const text = headingNodeText(node).trim();
      const id = slug(text);
      if ((level === 2 || level === 3) && text) {
        items.push({ id, level, text });
      }
    }
    for (const child of node.content ?? []) visit(child);
  }

  for (const node of doc.content) visit(node);
  return items;
}
