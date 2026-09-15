import { auth } from "@/auth";
import { redirect } from "next/navigation";

/**
 * Pages meant for paper.
 *
 * Its own route group because (dashboard)/layout.tsx wraps everything in a
 * navbar, a sidebar and an `h-screen` scroll shell — none of which belongs on a
 * printed page, and all of which would have to be hidden again in print CSS.
 * The auth gate does have to be repeated: it lives in that layout, and this
 * group never passes through it.
 *
 * Explicit light colours, not the app's `dark:` pairs. The root layout follows
 * prefers-color-scheme, and a roster is read on paper and under classroom
 * lights — printing a teacher's dark theme would waste a cartridge per rotation.
 */
export default async function PrintLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return <div className="min-h-screen bg-white text-black">{children}</div>;
}
