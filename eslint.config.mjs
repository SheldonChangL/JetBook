import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // 禁止 JSX 硬編碼 UI 字串：所有面向使用者的文字必須來自 messages/zh-TW.json（next-intl）。
    files: ["src/**/*.tsx"],
    rules: {
      "react/jsx-no-literals": [
        "error",
        {
          noStrings: true,
          // 屬性字串（className、id、data-* 等）不屬於 UI 文案，允許。
          ignoreProps: true,
          noAttributeStrings: false,
          // 標點與排版符號白名單（非翻譯內容）。
          allowedStrings: [" ", "·", "・", "—", "–", "-", "|", "/", "…", "：", "，", "。", "、", "（", "）", "(", ")"],
        },
      ],
    },
  },
  {
    ignores: ["node_modules/**", ".next/**", "dist/**", "coverage/**", "next-env.d.ts"],
  },
];

export default eslintConfig;
