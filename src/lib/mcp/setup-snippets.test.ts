import { describe, expect, it } from "vitest";
import { MCP_TOKEN_PLACEHOLDER, buildMcpSnippets } from "./setup-snippets";

const parse = (config: string) =>
  JSON.parse(config) as { mcpServers: { jetbook: { command: string; args: string[] } } };

describe("buildMcpSnippets", () => {
  it("以 baseUrl 組出端點並去掉尾端斜線", () => {
    expect(buildMcpSnippets("https://kb.example.com///").endpoint).toBe(
      "https://kb.example.com/api/mcp",
    );
  });

  it("Windows 設定以 cmd /c 呼叫 npx（直接用 npx 會因 node 路徑含空白而啟動失敗）", () => {
    const { desktopWindows } = buildMcpSnippets("https://kb.example.com", "jbk_real");
    const { command, args } = parse(desktopWindows).mcpServers.jetbook;

    expect(command).toBe("cmd");
    expect(args.slice(0, 4)).toEqual(["/c", "npx", "-y", "mcp-remote"]);
  });

  it("macOS 設定直接以 npx 為 command", () => {
    const { desktopMac } = buildMcpSnippets("https://kb.example.com", "jbk_real");
    const { command, args } = parse(desktopMac).mcpServers.jetbook;

    expect(command).toBe("npx");
    expect(args.slice(0, 3)).toEqual(["-y", "mcp-remote", "https://kb.example.com/api/mcp"]);
  });

  it("兩個平台的 mcp-remote 參數除 cmd /c 前綴外完全一致", () => {
    const { desktopMac, desktopWindows } = buildMcpSnippets("https://kb.example.com", "jbk_real");

    expect(parse(desktopWindows).mcpServers.jetbook.args).toEqual([
      "/c",
      "npx",
      ...parse(desktopMac).mcpServers.jetbook.args,
    ]);
  });

  it("純 HTTP 端點在兩個平台都補上 --allow-http（mcp-remote 否則直接拒絕）", () => {
    const snippets = buildMcpSnippets("http://10.0.0.5:8080", "jbk_real");

    expect(snippets.insecure).toBe(true);
    for (const config of [snippets.desktopMac, snippets.desktopWindows]) {
      const { args } = parse(config).mcpServers.jetbook;
      expect(args).toContain("--allow-http");
      expect(args[args.indexOf("--allow-http") - 1]).toBe("http://10.0.0.5:8080/api/mcp");
    }
  });

  it("HTTPS 端點不加 --allow-http", () => {
    const snippets = buildMcpSnippets("https://kb.example.com", "jbk_real");

    expect(snippets.insecure).toBe(false);
    expect(snippets.desktopMac).not.toContain("--allow-http");
    expect(snippets.desktopWindows).not.toContain("--allow-http");
  });

  it("帶 token 時三份設定都是實際 token；未帶時用佔位字樣", () => {
    const withToken = buildMcpSnippets("https://kb.example.com", "jbk_secret");
    for (const snippet of [withToken.codeCommand, withToken.desktopMac, withToken.desktopWindows]) {
      expect(snippet).toContain("Authorization: Bearer jbk_secret");
      expect(snippet).not.toContain(MCP_TOKEN_PLACEHOLDER);
    }

    const withoutToken = buildMcpSnippets("https://kb.example.com");
    for (const snippet of [
      withoutToken.codeCommand,
      withoutToken.desktopMac,
      withoutToken.desktopWindows,
    ]) {
      expect(snippet).toContain(`Authorization: Bearer ${MCP_TOKEN_PLACEHOLDER}`);
    }
  });

  it("Claude Code 指令直接指向端點，不經 mcp-remote", () => {
    const { codeCommand } = buildMcpSnippets("http://10.0.0.5:8080", "jbk_real");

    expect(codeCommand).toContain("claude mcp add --transport http jetbook");
    expect(codeCommand).toContain("http://10.0.0.5:8080/api/mcp");
    expect(codeCommand).not.toContain("mcp-remote");
    expect(codeCommand).not.toContain("--allow-http");
  });
});
