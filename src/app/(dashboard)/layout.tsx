import Navbar from "@/components/layout/Navbar";
import Sidebar, { MobileNav } from "@/components/layout/Sidebar";
import { auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  return (
    <div className="flex flex-col min-h-screen">
      <Navbar />
      <MobileNav />
      <div className="flex flex-1">
        <Sidebar />
        {/* min-w-0 so a wide child (a table, a long club name) scrolls inside
            main instead of stretching the flex row and the whole page. */}
        <main className="flex-1 min-w-0 p-4 sm:p-6 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
