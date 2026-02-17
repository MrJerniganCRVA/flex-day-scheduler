import { auth } from "@/auth";
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";

function getDashboardPath(role?: Role): string {
  switch (role) {
    case "ADMIN":
      return "/admin";
    case "TEACHER":
      return "/teacher";
    default:
      return "/student";
  }
}

export default async function Home() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  redirect(getDashboardPath(session.user.role));
}
