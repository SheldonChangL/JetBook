import { isValidElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import {
  CODE_LANGUAGES,
  codeLanguageLabel,
  lowlight,
} from "./lowlight";
import { highlightToReact } from "./highlight-to-react";

/** 遞迴收集 React 節點樹中所有 className，供斷言高亮 token 是否產生。 */
function collectClassNames(node: ReactNode, acc: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const child of node) collectClassNames(child, acc);
    return acc;
  }
  if (isValidElement(node)) {
    const props = node.props as { className?: unknown; children?: ReactNode };
    if (typeof props.className === "string") acc.push(props.className);
    collectClassNames(props.children ?? null, acc);
  }
  return acc;
}

/** 遞迴取出 React 節點樹中的所有文字，驗證高亮不會遺漏原始碼。 */
function collectText(node: ReactNode, acc: string[] = []): string[] {
  if (typeof node === "string") {
    acc.push(node);
    return acc;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, acc);
    return acc;
  }
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode };
    collectText(props.children ?? null, acc);
  }
  return acc;
}

describe("lowlight 語言註冊（D-04）", () => {
  it("common 涵蓋 ≥20 種語言（F-EDIT-06）", () => {
    expect(lowlight.listLanguages().length).toBeGreaterThanOrEqual(20);
  });

  it("常見語言均已註冊", () => {
    for (const lang of ["typescript", "javascript", "python", "sql", "json", "bash"]) {
      expect(lowlight.registered(lang)).toBe(true);
    }
  });
});

describe("CODE_LANGUAGES 下拉選項", () => {
  it("排除 plaintext、≥20 項、依 label 升序、且皆已註冊", () => {
    expect(CODE_LANGUAGES.length).toBeGreaterThanOrEqual(20);
    expect(CODE_LANGUAGES.some((o) => o.value === "plaintext")).toBe(false);
    for (const opt of CODE_LANGUAGES) {
      expect(lowlight.registered(opt.value)).toBe(true);
    }
    const labels = CODE_LANGUAGES.map((o) => o.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, "en")));
  });
});

describe("codeLanguageLabel", () => {
  it("已知語言回傳友善名稱", () => {
    expect(codeLanguageLabel("typescript")).toBe("TypeScript");
    expect(codeLanguageLabel("cpp")).toBe("C++");
  });
  it("無語言／plaintext 回傳 null", () => {
    expect(codeLanguageLabel(null)).toBeNull();
    expect(codeLanguageLabel(undefined)).toBeNull();
    expect(codeLanguageLabel("plaintext")).toBeNull();
    expect(codeLanguageLabel("")).toBeNull();
  });
});

describe("highlightToReact", () => {
  it("已註冊語言產生帶 hljs token 的節點且保留完整原始碼", () => {
    const code = "const answer: number = 42;";
    const nodes = highlightToReact(code, "typescript");
    const classNames = collectClassNames(nodes);
    expect(classNames.some((c) => c.startsWith("hljs-"))).toBe(true);
    expect(collectText(nodes).join("")).toBe(code);
  });

  it("無語言／plaintext／未註冊語言回傳原始字串（不高亮）", () => {
    const code = "just plain text";
    expect(highlightToReact(code, null)).toBe(code);
    expect(highlightToReact(code, "plaintext")).toBe(code);
    expect(highlightToReact(code, "not-a-real-language")).toBe(code);
  });
});
