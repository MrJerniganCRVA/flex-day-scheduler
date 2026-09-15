import { redirect } from "next/navigation";

/** Duty posts moved onto the Setup page. Kept so existing links and bookmarks work. */
export default function AdminDutyPostsPage() {
  redirect("/admin/setup?tab=duty-posts");
}
