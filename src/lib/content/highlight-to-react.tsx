import { Fragment, createElement, type ReactNode } from "react";
import type { ElementContent, RootContent } from "hast";
import { lowlight } from "./lowlight";

/**
 * lowlight hast → React 節點（D-04，閱讀端語法高亮共用工具）。
 * 只處理 lowlight 產出的 element / text 兩種節點；className 陣列併為字串。
 * 純函式、無 DOM 依賴，可於 RSC（server component）直接呼叫。
 * 以 createElement 建構（不用 JSX）以維持 lib 層可被單元測試直接匯入。
 */
function hastToReact(nodes: readonly (RootContent | ElementContent)[]): ReactNode {
  return nodes.map((node, index) => {
    if (node.type === "text") {
      return createElement(Fragment, { key: index }, node.value);
    }
    if (node.type === "element") {
      const rawClass = node.properties?.className;
      const className = Array.isArray(rawClass)
        ? rawClass.join(" ")
        : typeof rawClass === "string"
          ? rawClass
          : undefined;
      return createElement(
        node.tagName,
        { key: index, className },
        hastToReact(node.children),
      );
    }
    return null;
  });
}

/**
 * 將程式碼字串轉為帶高亮的 React 節點。
 * 未指定語言、plaintext 或未註冊的語言：原樣回傳純文字（不高亮）。
 */
export function highlightToReact(
  code: string,
  language: string | null | undefined,
): ReactNode {
  if (language && language !== "plaintext" && lowlight.registered(language)) {
    return hastToReact(lowlight.highlight(language, code).children);
  }
  return code;
}
