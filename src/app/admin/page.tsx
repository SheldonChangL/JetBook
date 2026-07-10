import { redirect } from "next/navigation";

/** 後台首頁：目前僅使用者管理與系統狀態兩項，直接導向使用者管理。 */
export default function AdminIndexPage() {
  redirect("/admin/users");
}
