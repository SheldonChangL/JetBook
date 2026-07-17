import "server-only";
import { env } from "@/lib/env";
import pkg from "../../package.json";
import { resolveBuildInfo, type BuildInfo } from "./build-info";

/**
 * 目前執行 image 的 build 資訊（#267）。值於 build 階段注入（見 Dockerfile ARG／ENV、
 * docker-compose build args、.github/workflows/ci.yml build-args），runtime 唯讀；
 * 本機開發未注入時 fallback（commit=dev，version 取 package.json）。
 */
export function getBuildInfo(): BuildInfo {
  return resolveBuildInfo({
    appVersion: env.APP_VERSION,
    gitCommit: env.GIT_COMMIT,
    buildTime: env.BUILD_TIME,
    packageVersion: pkg.version,
  });
}

export type { BuildInfo };
