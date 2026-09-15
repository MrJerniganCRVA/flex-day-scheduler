import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import MyFlexDay from "@/components/dashboard/MyFlexDay";
import { CALENDAR_PROMPTED_COOKIE } from "@/lib/google-oauth";
import CalendarConnectBanner, {
  type CalendarGrantState,
} from "@/components/calendar/CalendarConnectBanner";

export default async function TeacherDashboard({
  searchParams,
}: {
  searchParams: Promise<{ calendar?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // ── Can this teacher send their own invites? ──────────────────────────────
  //
  // Google refuses to let the app touch anyone's calendar until they have
  // personally allowed it, and this Workspace grants no Domain-Wide Delegation
  // to do it centrally. A teacher who has not connected still gets their invites
  // out — finalize falls back to an admin — so nothing here blocks the page; it
  // only asks.
  const grant = await prisma.calendarGrant.findUnique({
    where: { userId: session.user.id },
    select: { revokedAt: true },
  });
  const calendarState: CalendarGrantState = !grant
    ? "missing"
    : grant.revokedAt
      ? "revoked"
      : "connected";

  const { calendar: calendarFlag } = await searchParams;

  // Send a teacher straight to Google on their first visit, so consenting reads
  // as part of signing in rather than as a chore they have to notice. The cookie
  // is set by the connect route before Google is reached, so declining leaves
  // them here with the banner instead of bouncing straight back out.
  const alreadyPrompted =
    (await cookies()).get(CALENDAR_PROMPTED_COOKIE) !== undefined;
  if (calendarState === "missing" && !alreadyPrompted && !calendarFlag) {
    redirect("/api/calendar/connect");
  }

  return (
    <div className="space-y-8">
      <CalendarConnectBanner
        state={calendarState}
        justReturned={
          calendarFlag === "connected" ||
          calendarFlag === "declined" ||
          calendarFlag === "failed"
            ? calendarFlag
            : undefined
        }
      />

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Teacher Dashboard
        </h1>
        <Link
          href="/teacher/clubs/new"
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
        >
          + New Club
        </Link>
      </div>

      <MyFlexDay
        userId={session.user.id}
        newSessionHref="/teacher/sessions/new"
      />
    </div>
  );
}
