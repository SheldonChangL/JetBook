import { common, createLowlight } from "lowlight";

/**
 * 共用 lowlight 實例（D-04）。編輯端（CodeBlockLowlight ProseMirror 裝飾）與
 * 閱讀端（highlight-to-react）共用同一份語言註冊，確保高亮結果一致。
 *
 * `common` 涵蓋 ≥20 種常用語言（實測 37 種），滿足 F-EDIT-06 的語言高亮要求；
 * highlight.js 為 BSD-3-Clause、lowlight 為 MIT，皆符合相依授權約束。
 */
export const lowlight = createLowlight(common);

/** 語言顯示名稱對照（proper noun，不進 i18n）；未列者以原始鍵名顯示。 */
const LANGUAGE_LABELS: Record<string, string> = {
  arduino: "Arduino",
  bash: "Bash",
  c: "C",
  cpp: "C++",
  csharp: "C#",
  css: "CSS",
  diff: "Diff",
  go: "Go",
  graphql: "GraphQL",
  ini: "INI / TOML",
  java: "Java",
  javascript: "JavaScript",
  json: "JSON",
  kotlin: "Kotlin",
  less: "Less",
  lua: "Lua",
  makefile: "Makefile",
  markdown: "Markdown",
  objectivec: "Objective-C",
  perl: "Perl",
  php: "PHP",
  "php-template": "PHP Template",
  python: "Python",
  "python-repl": "Python REPL",
  r: "R",
  ruby: "Ruby",
  rust: "Rust",
  scss: "SCSS",
  shell: "Shell",
  sql: "SQL",
  swift: "Swift",
  typescript: "TypeScript",
  vbnet: "VB.NET",
  wasm: "WebAssembly",
  xml: "HTML / XML",
  yaml: "YAML",
};

export interface CodeLanguageOption {
  value: string;
  label: string;
}

/**
 * 語言下拉選項（依 label 排序，供搜尋式 Combobox）。
 * 由實際註冊的語言推導，避免清單與 lowlight 漂移；排除 plaintext（＝無語言預設）。
 */
export const CODE_LANGUAGES: readonly CodeLanguageOption[] = lowlight
  .listLanguages()
  .filter((name) => name !== "plaintext")
  .map((name) => ({ value: name, label: LANGUAGE_LABELS[name] ?? name }))
  .sort((a, b) => a.label.localeCompare(b.label, "en"));

/**
 * 取語言的顯示標籤；無語言／plaintext 回傳 null（閱讀端改以 i18n「純文字」顯示）。
 */
export function codeLanguageLabel(language: string | null | undefined): string | null {
  if (!language || language === "plaintext") return null;
  return LANGUAGE_LABELS[language] ?? language;
}
