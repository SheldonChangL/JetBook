import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// worker 打包：單檔 dist/worker.js（依賴全 bundle，pg-native 除外）。
// server-only 以空模組替換（worker 為純 node 行程，非 RSC）。
await build({
  entryPoints: [resolve(root, "src/worker.ts")],
  outfile: resolve(root, "dist/worker.js"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  sourcemap: true,
  alias: {
    "server-only": resolve(root, "src/test/server-only-stub.ts"),
    "@": resolve(root, "src"),
  },
  external: ["pg-native"],
  logLevel: "info",
});
