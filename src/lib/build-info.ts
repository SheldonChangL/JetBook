/**
 * Build 版本資訊（#267）——純邏輯與型別，不碰 env／server-only，可供 client 元件與測試使用。
 * 取值與注入方式見 build-info-server.ts（server 端唯一入口）。
 */

export type BuildInfo = {
  /** 應用版本（package.json version 或注入的 APP_VERSION） */
  version: string;
  /** 建置 commit 完整 SHA；本機未注入時為 "dev" */
  commit: string;
  /** commit 短碼（前 7 碼）；本機未注入時為 "dev" */
  shortCommit: string;
  /** 建置時間（ISO-8601 UTC）；本機未注入時為空字串 */
  builtAt: string;
};

/**
 * 由原始 build-arg 值（可能未注入或為空——Docker 預設空 ARG）解析出顯示用的 build 資訊。
 * commit 缺漏／空白＝本機開發，回 "dev"；version 缺漏時 fallback 至 package.json version。
 */
export function resolveBuildInfo(raw: {
  appVersion?: string;
  gitCommit?: string;
  buildTime?: string;
  packageVersion: string;
}): BuildInfo {
  const version = raw.appVersion?.trim() || raw.packageVersion;
  const commit = raw.gitCommit?.trim() || "dev";
  const shortCommit = commit === "dev" ? "dev" : commit.slice(0, 7);
  const builtAt = raw.buildTime?.trim() || "";
  return { version, commit, shortCommit, builtAt };
}
