import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import { ROTATION_LABELS } from "@/types";
import type { RotationSlot } from "@prisma/client";
import Link from "next/link";
import CancelButton from "@/components/signups/CancelButton";
import {
  getSignupDeadline,
  isPastSignupDeadline,
  schoolTimeZone,
} from "@/lib/flex-day-utils";

/** Shape of one row rendered by SignupTable, as selected by the query below. */
type SignupRow = Awaited<ReturnType<typeof fetchSignups>>[number];

function fetchSignups(studentId: string) {
  return prisma.signup.findMany({
    where: { studentId },
    include: {
      clubSession: {
        include: {
          club: {
            select: {
              id: true,
              name: true,
              defaultRoom: { select: { name: true } },
            },
          },
          roomOverride: { select: { name: true } },
          flexDay: { select: { id: true, date: true, label: true } },
        },
      },
    },
    orderBy: { clubSession: { flexDay: { date: "asc" } } },
  });
}

function SignupTable({
  rows,
  showCancel,
  showAttendance,
}: {
  rows: SignupRow[];
  showCancel: boolean;
  showAttendance: boolean;
}) {
  return (
    // overflow-x-auto, not overflow-hidden: on a phone this table is wider than
    // the screen, and hiding the overflow simply cut the Cancel button off.
    <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
      <table className="w-full text-sm min-w-[34rem]">
        <thead className="bg-gray-50 dark:bg-gray-800 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
          <tr>
            <th className="px-4 py-3 text-left">Date</th>
            <th className="px-4 py-3 text-left">Club</th>
            <th className="px-4 py-3 text-left">Rotations</th>
            <th className="px-4 py-3 text-left">Location</th>
            {showCancel && <th className="px-4 py-3 text-left">Status</th>}
            {showAttendance && <th className="px-4 py-3 text-left">Attended</th>}
            {showCancel && <th className="px-4 py-3" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
          {rows.map((signup) => {
            const deadlinePast = isPastSignupDeadline(signup.clubSession.flexDay.date);
            const deadline = getSignupDeadline(signup.clubSession.flexDay.date);
            const location =
              signup.clubSession.roomOverride?.name ??
              signup.clubSession.club?.defaultRoom?.name ??
              null;

            return (
              <tr key={signup.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                <td className="px-4 py-3 text-gray-700 dark:text-gray-200">
                  {new Date(signup.clubSession.flexDay.date).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    timeZone: "UTC",
                  })}
                  {signup.clubSession.flexDay.label && (
                    <div className="text-xs text-gray-400 dark:text-gray-500">
                      {signup.clubSession.flexDay.label}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                  {/* title first, matching every other display of a session
                      name in the app — a title only exists on a one-off
                      session, which has no club, so the two orderings agree
                      today, but they would diverge the moment a club session
                      gains a title override. */}
                  {signup.clubSession.title ?? signup.clubSession.club?.name ?? "Session"}
                </td>
                <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                  {signup.clubSession.rotations
                    .map((r: RotationSlot) => ROTATION_LABELS[r])
                    .join(", ")}
                </td>
                <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                  {location ?? (
                    <span className="text-gray-300 dark:text-gray-600">—</span>
                  )}
                </td>
                {showCancel && (
                  <td className="px-4 py-3">
                    {deadlinePast ? (
                      <span className="inline-flex items-center rounded-full bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-2 py-0.5 text-xs font-medium text-red-600 dark:text-red-400">
                        Deadline passed
                      </span>
                    ) : (
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        Cancel by{" "}
                        {deadline.toLocaleDateString("en-US", {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          timeZone: schoolTimeZone(),
                        })}{" "}
                        at{" "}
                        {deadline.toLocaleTimeString("en-US", {
                          hour: "numeric",
                          minute: "2-digit",
                          timeZone: schoolTimeZone(),
                          timeZoneName: "short",
                        })}
                      </span>
                    )}
                  </td>
                )}
                {showAttendance && (
                  <td className="px-4 py-3">
                    {signup.attended === true ? (
                      <span className="inline-flex items-center rounded-full bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
                        Present
                      </span>
                    ) : signup.attended === false ? (
                      <span className="inline-flex items-center rounded-full bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-2 py-0.5 text-xs font-medium text-red-600 dark:text-red-400">
                        Absent
                      </span>
                    ) : (
                      <span className="text-gray-300 dark:text-gray-600">—</span>
                    )}
                  </td>
                )}
                {showCancel && (
                  <td className="px-4 py-3 text-right">
                    <CancelButton signupId={signup.id} disabled={deadlinePast} />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default async function MySignupsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const signups = await fetchSignups(session.user.id);

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const upcoming = signups.filter(
    (s) => new Date(s.clubSession.flexDay.date) >= today
  );
  const past = signups.filter(
    (s) => new Date(s.clubSession.flexDay.date) < today
  );

  if (signups.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">My Signups</h1>
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 p-12 text-center text-gray-400 dark:text-gray-500">
          You haven&apos;t signed up for any clubs yet.{" "}
          <Link href="/student" className="text-indigo-600 dark:text-indigo-400 hover:underline">
            Browse upcoming Flex Days
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">My Signups</h1>

      {upcoming.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
            Upcoming
          </h2>
          <SignupTable rows={upcoming} showCancel={true} showAttendance={false} />
        </section>
      )}

      {past.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
            Past
          </h2>
          <div className="opacity-60">
            <SignupTable rows={past} showCancel={false} showAttendance={true} />
          </div>
        </section>
      )}
    </div>
  );
}
