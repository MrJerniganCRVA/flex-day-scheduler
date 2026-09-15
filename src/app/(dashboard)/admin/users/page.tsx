import { redirect } from "next/navigation";

/** User management moved onto the People page. Kept so existing links work. */
export default function AdminUsersPage() {
  redirect("/admin/people?tab=students");
}
