import { describe, expect, it } from "vitest";
import { chunkMarkdown, estimateTokens, MAX_TOKENS } from "./chunker";

const 長段 = "雷射模組安裝前必須確認防潮箱濕度並完成靜電防護。".repeat(60); // ~1400 tokens

describe("estimateTokens", () => {
  it("CJK 每字計 1", () => {
    expect(estimateTokens("雷射校準")).toBe(4);
  });
  it("英文以詞估算", () => {
    expect(estimateTokens("laser module install")).toBe(Math.ceil(3 * 1.3));
  });
});

describe("chunkMarkdown", () => {
  it("依 heading 切 section 並帶 heading path", () => {
    const md = "# 安裝\n\n前置說明。\n\n## 防潮\n\n濕度需低於 40%。";
    const chunks = chunkMarkdown("雷射手冊", md);
    expect(chunks.length).toBe(2);
    expect(chunks[0]?.headingPath).toBe("安裝");
    expect(chunks[1]?.headingPath).toBe("安裝 › 防潮");
  });

  it("context header 前置頁面標題與路徑", () => {
    const md = "# 校準\n\n預熱 30 分鐘。";
    const [chunk] = chunkMarkdown("雷射手冊", md);
    expect(chunk?.text.startsWith("雷射手冊 › 校準\n\n")).toBe(true);
    expect(chunk?.rawText).toBe("預熱 30 分鐘。");
  });

  it("code fence 不被切斷（原子）", () => {
    const code = "```bash\n" + "echo line\n".repeat(300) + "```";
    const md = `# 指令\n\n${code}`;
    const chunks = chunkMarkdown("手冊", md);
    const codeChunk = chunks.find((c) => c.rawText.includes("echo line"));
    expect(codeChunk?.rawText).toContain("```bash");
    expect(codeChunk?.rawText.trimEnd().endsWith("```")).toBe(true);
  });

  it("表格為原子單位", () => {
    const table = Array.from({ length: 40 }, (_, i) => `| 料號-${i} | 值-${i} |`).join("\n");
    const md = `# 規格\n\n說明文字。\n\n${table}`;
    const chunks = chunkMarkdown("手冊", md);
    const tableChunks = chunks.filter((c) => c.rawText.includes("| 料號-0 |"));
    expect(tableChunks).toHaveLength(1);
    expect(tableChunks[0]?.rawText).toContain("| 料號-39 |");
  });

  it("超長段落依句子二次切分且不超過上限", () => {
    const md = `# 說明\n\n${長段}`;
    const chunks = chunkMarkdown("手冊", md);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(MAX_TOKENS);
    }
  });

  it("相鄰 chunk 有重疊（前塊尾段出現在後塊開頭）", () => {
    const paragraphs = Array.from(
      { length: 12 },
      (_, i) => `第${i}段：雷射模組檢驗流程說明，內容約數十字，用於測試打包與重疊。`.repeat(3),
    ).join("\n\n");
    const md = `# 流程\n\n${paragraphs}`;
    const chunks = chunkMarkdown("手冊", md);
    expect(chunks.length).toBeGreaterThan(1);
    // 後塊開頭（overlap 部分）必為前塊尾端的子字串
    const overlapPart = chunks[1]!.rawText.split("\n\n")[0]!;
    expect(overlapPart.length).toBeGreaterThan(0);
    expect(chunks[0]!.rawText.endsWith(overlapPart)).toBe(true);
  });

  it("contentHash 穩定且不含 header（header 變更不觸發重嵌）", () => {
    const md = "# 校準\n\n預熱 30 分鐘。";
    const [a] = chunkMarkdown("標題甲", md);
    const [b] = chunkMarkdown("標題乙", md);
    expect(a?.contentHash).toBe(b?.contentHash);
    expect(a?.text).not.toBe(b?.text);
  });

  it("無 heading 的內容也能切", () => {
    const chunks = chunkMarkdown("手冊", "純段落內容，無任何標題。");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.headingPath).toBe("");
    expect(chunks[0]?.text.startsWith("手冊\n\n")).toBe(true);
  });

  it("空文件回空陣列", () => {
    expect(chunkMarkdown("手冊", "")).toEqual([]);
  });
});
