import { createHash } from "crypto";

/**
 * 內容 Chunker（H-05，RAG pipeline 第一步；架構 B.7）。
 * - 以 content_md 依 heading 階層（#～###）切分為 section
 * - 目標 chunk 300–500 tokens、上限 800；超長 section 依段落二次切分
 * - 表格與 fenced code block 視為原子單位，不從中間切斷
 * - 相鄰 chunk 約 10–15% 重疊（沿用前一 chunk 的尾端段落）
 * - 每個 chunk 前置「頁面標題 › heading path」context header（提升繁中檢索命中）
 * - contentHash 供增量重嵌（內容不變的 chunk 不重算 embedding）
 */

export interface Chunk {
  index: number;
  /** 送 embedding 的完整文字（含 context header） */
  text: string;
  /** 原始內容（不含 header；hash 依此計算） */
  rawText: string;
  headingPath: string;
  tokenCount: number;
  contentHash: string;
}

export const TARGET_TOKENS = 500;
export const MAX_TOKENS = 800;
/** heading 階層路徑分隔符（headingPath 序列化用；跳轉錨點解析須以此反解）。 */
export const HEADING_PATH_SEPARATOR = " › ";
const MIN_MERGE_TOKENS = 300;
/** 重疊上限：target 的 15% */
const MAX_OVERLAP_TOKENS = Math.floor(TARGET_TOKENS * 0.15);

/**
 * 粗略 token 估算：CJK 每字 ≈1 token；其餘以空白分詞每詞 ≈1.3 token。
 * 只需相對一致性（切分決策用），不需與特定模型精確對齊。
 */
export function estimateTokens(text: string): number {
  const cjk = text.match(/[㐀-鿿豈-﫿]/g)?.length ?? 0;
  const rest = text.replace(/[㐀-鿿豈-﫿]/g, " ");
  const words = rest.split(/\s+/).filter(Boolean).length;
  return Math.ceil(cjk + words * 1.3);
}

interface Block {
  text: string;
  atomic: boolean;
}

/** 把 section 內容切成段落級 block；code fence 與表格為原子 block。 */
function splitBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let buffer: string[] = [];
  let inFence = false;
  let fenceBuffer: string[] = [];

  const flushParagraph = () => {
    const text = buffer.join("\n").trim();
    if (text) blocks.push({ text, atomic: false });
    buffer = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (inFence) {
      fenceBuffer.push(line);
      if (line.trimStart().startsWith("```")) {
        blocks.push({ text: fenceBuffer.join("\n"), atomic: true });
        fenceBuffer = [];
        inFence = false;
      }
      continue;
    }
    if (line.trimStart().startsWith("```")) {
      flushParagraph();
      inFence = true;
      fenceBuffer = [line];
      continue;
    }
    // 表格：連續以 | 開頭的行合為一個原子 block
    if (line.trimStart().startsWith("|")) {
      flushParagraph();
      const table: string[] = [];
      while (i < lines.length && lines[i]!.trimStart().startsWith("|")) {
        table.push(lines[i]!);
        i += 1;
      }
      i -= 1;
      blocks.push({ text: table.join("\n"), atomic: true });
      continue;
    }
    if (line.trim() === "") {
      flushParagraph();
      continue;
    }
    buffer.push(line);
  }
  if (inFence && fenceBuffer.length) blocks.push({ text: fenceBuffer.join("\n"), atomic: true });
  flushParagraph();
  return blocks;
}

interface Section {
  headingPath: string[];
  blocks: Block[];
}

/** 依 heading（#～###）切 section，維護 heading 階層路徑。 */
function splitSections(markdown: string): Section[] {
  const lines = markdown.split("\n");
  const sections: Section[] = [];
  const stack: { level: number; title: string }[] = [];
  let currentLines: string[] = [];

  const flush = () => {
    if (currentLines.length === 0) return;
    sections.push({
      headingPath: stack.map((h) => h.title),
      blocks: splitBlocks(currentLines),
    });
    currentLines = [];
  };

  let inFence = false;
  for (const line of lines) {
    if (line.trimStart().startsWith("```")) inFence = !inFence;
    const match = !inFence && /^(#{1,3})\s+(.*)$/.exec(line);
    if (match) {
      flush();
      const level = match[1]!.length;
      while (stack.length && stack[stack.length - 1]!.level >= level) stack.pop();
      stack.push({ level, title: match[2]!.trim() });
      continue;
    }
    currentLines.push(line);
  }
  flush();
  return sections.filter((s) => s.blocks.length > 0);
}

/** 把 blocks 依 token 上限貪婪打包成 chunk 群。 */
function packBlocks(blocks: Block[]): string[][] {
  const groups: string[][] = [];
  let current: string[] = [];
  let currentTokens = 0;

  for (const block of blocks) {
    const blockTokens = estimateTokens(block.text);
    // 單一原子/超長 block：自成一個 chunk（不切斷程式碼與表格）
    if (blockTokens > MAX_TOKENS) {
      if (current.length) {
        groups.push(current);
        current = [];
        currentTokens = 0;
      }
      if (block.atomic) {
        groups.push([block.text]);
      } else {
        // 超長段落：依句子二次切
        for (const piece of splitLongParagraph(block.text)) groups.push([piece]);
      }
      continue;
    }
    if (currentTokens + blockTokens > TARGET_TOKENS && currentTokens >= MIN_MERGE_TOKENS) {
      groups.push(current);
      current = [];
      currentTokens = 0;
    } else if (currentTokens + blockTokens > MAX_TOKENS) {
      groups.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(block.text);
    currentTokens += blockTokens;
  }
  if (current.length) groups.push(current);
  return groups;
}

function splitLongParagraph(text: string): string[] {
  const sentences = text.split(/(?<=[。！？!?；;])/);
  const pieces: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (estimateTokens(current + sentence) > TARGET_TOKENS && current) {
      pieces.push(current);
      current = "";
    }
    current += sentence;
  }
  if (current.trim()) pieces.push(current);
  return pieces;
}

/**
 * 取前一 chunk 尾端作為 overlap：整段夠小就取整段，
 * 否則從段尾以句子為單位向前湊到 MAX_OVERLAP_TOKENS。
 * 原子區塊（code/表格）不做 overlap。
 */
function tailForOverlap(parts: string[]): string | null {
  const last = parts[parts.length - 1];
  if (!last) return null;
  const trimmed = last.trimStart();
  if (trimmed.startsWith("```") || trimmed.startsWith("|")) return null;
  if (estimateTokens(last) <= MAX_OVERLAP_TOKENS) return last;

  const sentences = last.split(/(?<=[。！？!?；;])/).filter(Boolean);
  const tail: string[] = [];
  let tokens = 0;
  for (let i = sentences.length - 1; i >= 0; i -= 1) {
    const sentenceTokens = estimateTokens(sentences[i]!);
    if (tokens + sentenceTokens > MAX_OVERLAP_TOKENS) break;
    tail.unshift(sentences[i]!);
    tokens += sentenceTokens;
  }
  const text = tail.join("").trim();
  return text ? text : null;
}

export function chunkMarkdown(pageTitle: string, markdown: string): Chunk[] {
  const sections = splitSections(markdown);
  const chunks: Chunk[] = [];

  for (const section of sections) {
    const groups = packBlocks(section.blocks);
    const headingPath = section.headingPath.join(HEADING_PATH_SEPARATOR);
    let previousParts: string[] | null = null;

    for (const group of groups) {
      // 同 section 內相鄰 chunk 重疊：沿用前一 chunk 尾端段落
      const overlap = previousParts ? tailForOverlap(previousParts) : null;
      const parts = overlap ? [overlap, ...group] : group;
      const rawText = parts.join("\n\n");
      const header = headingPath ? `${pageTitle} › ${headingPath}` : pageTitle;
      chunks.push({
        index: chunks.length,
        text: `${header}\n\n${rawText}`,
        rawText,
        headingPath,
        tokenCount: estimateTokens(rawText),
        contentHash: createHash("sha256").update(rawText).digest("hex"),
      });
      previousParts = group;
    }
  }
  return chunks;
}
