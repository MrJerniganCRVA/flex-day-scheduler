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
    // h-screen, not min-h-screen: main already says overflow-auto, but with an
    // auto-height shell it never had a height to overflow, so the body scrolled
    // and main's scrollport grew to fit. That left any page wanting to fill the
    // viewport — the coverage grid, with its pinned rotation headers — no choice
    // but to guess at a height and produce a second scrollbar inside the first.
    // Now the chrome stays put and each page scrolls inside main.
    <div className="flex flex-col h-screen">
      <Navbar />
      <MobileNav />
      {/* min-h-0 so this row may be shorter than its content; without it a flex
          child's auto minimum keeps the row at content height and main still
          cannot scroll. */}
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        {/* min-w-0 so a wide child (a table, a long club name) scrolls inside
            main instead of stretching the flex row and the whole page. */}
        <main className="flex-1 min-w-0 p-4 sm:p-6 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
