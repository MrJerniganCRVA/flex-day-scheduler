import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import type { RotationSlot } from "@prisma/client";
import { ALL_ROTATIONS, ROTATION_LABELS } from "@/types";
import { resolveRoomName } from "@/lib/session-event";
import { mySessionsFilter } from "@/lib/my-sessions";
import { sortByLastName } from "@/lib/student-name";
import { SESSION_ABSENCE_SELECT } from "@/lib/coverage";
import PrintButton from "@/components/print/PrintButton";

/**
 * A printable roster for one person's own Flex Day — one page per rotation.
 *
 * Paper, because a Flex Day is worked standing in a room with a phone in one
 * hand, and because the app being up is not something to rely on at 9am. The
 * admin CSV (/api/admin/flex-days/[id]/export) is the school-wide version of
 * that contingency and is one row per *student*; it is not something a teacher
 * can call names off.
 *
 * Rendered as a page rather than generated as a PDF: the browser's own dialog
 * prints it or saves it as a PDF, so there is no PDF dependency to carry, and
 * the roster cannot be stale against the data the way a file downloaded the
 * night before can.
 *
 * Scoped by mySessionsFilter, the same predicate the dashboard uses — a teacher
 * can only ever print rosters for sessions they are attached to.
 */

const SESSION_INCLUDE = {
  roomOverride: { select: { name: true } },
  club: {
    select: {
      name: true,
      maxCapacity: true,
      defaultRoom: { select: { name: true } },
    },
  },
  teacherAbsences: { select: SESSION_ABSENCE_SELECT },
  signups: {
    select: {
      id: true,
      forced: true,
      student: { select: { name: true } },
    },
  },
} as const;

/**
 * Names per printed column.
 *
 * A club is capped at 100 students, and three columns of 34 fit one Letter page
 * under the header at 0.5in margins — so no roster ever runs to a second sheet
 * and "one page per rotation" stays true. Fewer columns for a short roster:
 * twelve names strung down one edge of an otherwise blank page reads worse than
 * a single list.
 */
function columnCount(size: number): 1 | 2 | 3 {
  if (size <= 15) return 1;
  if (size <= 40) return 2;
  return 3;
}

export default async function PrintRostersPage({
  params,
}: {
  params: Promise<{ flexDayId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const userId = session.user.id;

  const { flexDayId } = await params;

  const flexDay = await prisma.flexDay.findUnique({
    where: { id: flexDayId },
    include: {
      clubSessions: {
        where: mySessionsFilter(userId),
        include: SESSION_INCLUDE,
      },
    },
  });

  if (!flexDay) notFound();

  const dateLabel = new Date(flexDay.date).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

  /**
   * One printed page per session, in timetable order.
   *
   * A session runs in one rotation in all but the linked case, so this is "a
   * page per rotation" for every teacher who has one club per slot — and two
   * clubs sharing a rotation get a clean page each rather than colliding on one.
   * A session linked across two rotations is deliberately printed twice: it is
   * two roll calls, in two rooms' worth of time, and the second page is the one
   * that gets marked up at the second bell.
   *
   * Rotations this person has stepped back from are left out. The page exists to
   * be carried into a room they will be in; a roster for a session someone else
   * is covering is a page to throw away.
   */
  const pages = ALL_ROTATIONS.flatMap((rotation: RotationSlot) =>
    flexDay.clubSessions
      .filter(
        (cs) =>
          cs.rotations.includes(rotation) &&
          !cs.teacherAbsences.some(
            (a) => a.teacherId === userId && a.rotation === rotation
          )
      )
      .map((cs) => ({ rotation, session: cs }))
  );

  return (
    <div className="mx-auto max-w-4xl p-6 print:max-w-none print:p-0">
      {/* Screen-only: the print dialog hides it, and on paper it would be a
          button nobody can press. */}
      <div className="no-print mb-6 flex items-center justify-between gap-4 border-b border-gray-200 pb-4">
        <div>
          <h1 className="text-xl font-bold">Flex Day rosters</h1>
          <p className="text-sm text-gray-600">
            {dateLabel} · {pages.length}{" "}
            {pages.length === 1 ? "page" : "pages"}, one per rotation
          </p>
        </div>
        <PrintButton />
      </div>

      {pages.length === 0 ? (
        <p className="no-print text-sm text-gray-600">
          You have no sessions on this Flex Day, so there is nothing to print.
        </p>
      ) : (
        pages.map(({ rotation, session: cs }, i) => {
          const roster = sortByLastName(cs.signups, (s) => s.student.name);
          const room = resolveRoomName(cs);
          const capacity = cs.capacityOverride ?? cs.club?.maxCapacity ?? null;

          return (
            <section
              key={`${cs.id}-${rotation}`}
              // Every page but the last breaks after it — a trailing break
              // prints a blank sheet, which is exactly the kind of thing nobody
              // notices until they are standing at the printer.
              className={
                i < pages.length - 1
                  ? "break-after-page print:mb-0 mb-10"
                  : "print:mb-0 mb-10"
              }
            >
              <header className="mb-4 border-b-2 border-black pb-2">
                <div className="flex items-baseline justify-between gap-4">
                  <h2 className="text-2xl font-bold">
                    {cs.club?.name ?? cs.title ?? "Session"}
                  </h2>
                  <span className="text-lg font-semibold">
                    {ROTATION_LABELS[rotation]}
                  </span>
                </div>
                <div className="mt-1 flex items-baseline justify-between gap-4 text-sm">
                  <span>
                    {dateLabel}
                    {room && ` · ${room}`}
                  </span>
                  <span className="tabular-nums">
                    {roster.length}
                    {capacity !== null && `/${capacity}`}{" "}
                    {roster.length === 1 ? "student" : "students"}
                  </span>
                </div>
              </header>

              {roster.length === 0 ? (
                <p className="text-sm italic">No students signed up.</p>
              ) : (
                <ol
                  className={`text-[11pt] leading-tight ${
                    { 1: "columns-1", 2: "columns-2", 3: "columns-3" }[
                      columnCount(roster.length)
                    ]
                  } gap-6`}
                >
                  {roster.map((s, n) => (
                    <li
                      key={s.id}
                      className="flex break-inside-avoid items-center gap-2 py-[3px]"
                    >
                      <span className="w-6 shrink-0 text-right text-[9pt] text-gray-500 tabular-nums">
                        {n + 1}.
                      </span>
                      {/* A drawn box, not an <input>: nothing on paper should
                          look like a control someone could have ticked on
                          screen. */}
                      <span
                        aria-hidden
                        className="h-[13px] w-[13px] shrink-0 border border-black"
                      />
                      <span className="truncate">
                        {s.student.name}
                        {s.forced && (
                          <span className="ml-1 text-[8pt] text-gray-500">
                            (req)
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}
