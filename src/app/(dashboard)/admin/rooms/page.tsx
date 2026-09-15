import { redirect } from "next/navigation";

/** Rooms moved onto the Setup page. Kept so existing links and bookmarks work. */
export default function AdminRoomsPage() {
  redirect("/admin/setup?tab=rooms");
}
