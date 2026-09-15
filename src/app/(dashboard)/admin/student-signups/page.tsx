import { redirect } from "next/navigation";

/** Student signups moved onto the People page. Kept so existing links work. */
export default function AdminStudentSignupsPage() {
  redirect("/admin/people?tab=signups");
}
