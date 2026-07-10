import "server-only";
import { notFound, redirect } from "next/navigation";

/**
 * 授權失敗時的 403/404 導向決策（G-04，設計規範 §3.12）。
 *
 * 原則：不洩漏存在性。
 * - `private` Space：外人不得知道資源存在 → 一律 404（回應與「不存在」不可區分）。
 * - org 可見（org_read / org_write）Space：資源存在性本就對全員可見，
 *   無權限（如 restricted 頁）→ 導向 /forbidden?from=（403，M1 顯示 Space 管理員資訊）。
 */
export function denyPageRead(
  space: { visibility: "private" | "org_read" | "org_write" },
  from: string,
): never {
  if (space.visibility === "private") notFound();
  redirect(`/forbidden?from=${encodeURIComponent(from)}`);
}
