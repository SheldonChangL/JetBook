/**
 * MCP 客戶端接入設定的唯一產生器（純函式，供 UI 與測試共用）。
 *
 * 平台差異是本模組存在的理由：Claude Desktop 於 Windows 會把 `command` 解析成絕對路徑後
 * 包進 `cmd.exe /c` 且不加引號，node 預設安裝於 `C:\Program Files\nodejs`，
 * 於是 cmd 只吃到 `C:\Program` 就當成指令名、伺服器啟動即失敗。
 * 因此 Windows 一律輸出 `cmd` + `/c` + `npx`（讓 cmd 自己去 PATH 找 npx，
 * args 各元素獨立傳遞不受空白影響），macOS 維持直接呼叫 `npx`。
 */

/** 未帶 token 時呈現的佔位值：刻意用假的 ASCII 字樣，避免中文字混進可貼上的設定 */
export const MCP_TOKEN_PLACEHOLDER = "jbk_xxxxxxxxxxxx";

export type McpSnippets = {
  /** `<baseUrl>/api/mcp`，已去除 baseUrl 尾端斜線 */
  endpoint: string;
  /** 端點為非加密 http://：mcp-remote 需 --allow-http，且 Desktop 內建連接器不可用 */
  insecure: boolean;
  /** Claude Code CLI 指令（三平台通用，不經 mcp-remote） */
  codeCommand: string;
  /** claude_desktop_config.json — macOS */
  desktopMac: string;
  /** claude_desktop_config.json — Windows */
  desktopWindows: string;
};

export function buildMcpSnippets(baseUrl: string, token?: string): McpSnippets {
  const endpoint = `${baseUrl.replace(/\/+$/, "")}/api/mcp`;
  const bearer = token ?? MCP_TOKEN_PLACEHOLDER;
  const insecure = endpoint.startsWith("http://");

  const remoteArgs = [
    "-y",
    "mcp-remote",
    endpoint,
    ...(insecure ? ["--allow-http"] : []),
    "--header",
    `Authorization: Bearer ${bearer}`,
  ];

  const desktopConfig = (command: string, args: string[]) =>
    JSON.stringify({ mcpServers: { jetbook: { command, args } } }, null, 2);

  return {
    endpoint,
    insecure,
    codeCommand: `claude mcp add --transport http jetbook ${endpoint} \\\n  --header "Authorization: Bearer ${bearer}"`,
    desktopMac: desktopConfig("npx", remoteArgs),
    desktopWindows: desktopConfig("cmd", ["/c", "npx", ...remoteArgs]),
  };
}
