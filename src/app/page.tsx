import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getDashboardPath } from "@/lib/auth-helpers";

export default async function Home() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  redirect(getDashboardPath(session.user.role));
}
