import { Fragment } from "react";
import type { RotationSlot } from "@prisma/client";
import { ALL_ROTATIONS, ROTATION_LABELS } from "@/types";
import { CELL_SHELL, NotScheduledCell } from "@/components/dashboard/GridCell";
import {
  clubRows,
  dutyRow,
  type BoardDuty,
  type BoardGridRow,
  type BoardSession,
} from "@/lib/board-rows";

/**
 * The whole building's Flex Day, read-only.
 *
 * The admin Coverage page has always answered "what is happening, where, and who
 * is in the room" — but only for admins, because it is also the page where those
 * answers are *changed*. Support staff have the same question and none of the
 * authority: they need to know which room a club is in and which adult is with
 * it, and must not be able to reassign anybody.
 *
 * So this renders the same grid and none of the controls. It is a server
 * component with no "use client", no fetches and no route handler behind it,
 * because there is nothing here to save.
 *
 * Deliberately *not* a read-only mode on CoverageDashboard: that component's
 * cells take onAssign, saveStatus, availableTeachers and onUndoAbsence, and its
 * parent holds optimistic state, a pending-save counter and a clash resolver.
 * Threading "but not really" through all of it would make the editable page
 * harder to reason about in order to save this file. What the two genuinely must
 * agree on — how sessions fold into rows, and who is resolved into a cell — is
 * shared through src/lib/board-rows.ts and src/lib/coverage.ts instead.
 *
 * Also deliberately absent: the red and amber urgency tints, the "N uncovered"
 * header badges, the summary tiles, the clash banner and the gaps filter. Every
 * one of those exists to drive an admin towards a dropdown. A reader who cannot
 * act on a gap is better served by being told plainly that nobody is listed than
 * by an alarm they cannot answer.
 */

export default function BuildingBoard({
  sessions,
  duties,
  staff,
}: {
  sessions: BoardSession[];
  duties: BoardDuty[];
  staff: { id: string; name: string | null }[];
}) {
  const nameById = new Map(staff.map((u) => [u.id, u.name ?? "Unnamed"]));

  // Clubs first, then duty posts, each alphabetical — one grid rather than the
  // Coverage page's two tabs. Tabs are there because an admin asks "is every
  // club staffed?" and "does the building have eyes?" at different moments;
  // somebody walking the corridors is asking both at once.
  const rows: BoardGridRow[] = [...clubRows(sessions), ...duties.map(dutyRow)];

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 p-10 text-center text-gray-400 dark:text-gray-500">
        Nothing is scheduled for this Flex Day yet.
      </div>
    );
  }

  return (
    // Scrolls sideways rather than reflowing: the grid's value is that the three
    // rotations line up, and a phone-width layout that stacked them would lose
    // exactly that. The name column stays pinned so a row is still identifiable
    // once it has been scrolled to.
    <div className="w-full min-w-0 overflow-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
      <div className="grid min-w-[54rem] grid-cols-[minmax(11rem,15rem)_repeat(3,minmax(13rem,1fr))]">
        {/* ── Header row ────────────────────────────────────────────────── */}
        {/* Opaque, not the /50 the panels use elsewhere: these cells are sticky
            and would otherwise show the rows sliding under them. */}
        <div className="sticky left-0 top-0 z-30 border-b border-gray-200 dark:border-gray-700 bg-indigo-50 dark:bg-indigo-950 px-3 py-3">
          <span className="text-sm font-semibold text-indigo-700 dark:text-indigo-300">
            Club
          </span>
        </div>
        {ALL_ROTATIONS.map((rotation: RotationSlot) => (
          <div
            key={rotation}
            className="sticky top-0 z-20 border-b border-l border-gray-200 dark:border-gray-700 bg-indigo-50 dark:bg-indigo-950 px-3 py-3"
          >
            <span className="text-sm font-semibold text-indigo-700 dark:text-indigo-300">
              {ROTATION_LABELS[rotation]}
            </span>
          </div>
        ))}

        {/* ── Rows ──────────────────────────────────────────────────────── */}
        {rows.map((row) => {
          const subtitle =
            row.kind === "club" ? row.roomName : row.duty.location;

          return (
            <Fragment key={row.key}>
              <div className="sticky left-0 z-10 border-b border-gray-100 dark:border-gray-700/50 bg-white dark:bg-gray-900 px-3 py-3">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span
                      className="block truncate text-sm font-medium text-gray-900 dark:text-white"
                      title={row.name}
                    >
                      {row.name}
                    </span>
                    {subtitle && (
                      <span
                        className="block truncate text-xs text-gray-400 dark:text-gray-500"
                        title={subtitle}
                      >
                        {subtitle}
                      </span>
                    )}
                  </span>
                  {row.kind === "duty" && (
                    // Marks this as building supervision rather than a club, in
                    // the pill vocabulary the rest of the app uses — not an
                    // emoji, which renders differently on every platform.
                    <span className="shrink-0 rounded-full border border-gray-300 dark:border-gray-600 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:text-gray-400">
                      Duty
                    </span>
                  )}
                </div>
              </div>

              {ALL_ROTATIONS.map((rotation: RotationSlot) => {
                if (row.kind === "duty") {
                  if (!row.duty.rotations.includes(rotation))
                    return (
                      <NotScheduledCell
                        key={rotation}
                        label={`${row.name} is not required in ${ROTATION_LABELS[rotation]}`}
                      />
                    );

                  const teacherId = row.duty.assignments[rotation] ?? null;
                  return (
                    <div key={rotation} className={CELL_SHELL}>
                      {teacherId ? (
                        <TeacherLine name={nameById.get(teacherId)} />
                      ) : (
                        <Unlisted>Nobody assigned</Unlisted>
                      )}
                    </div>
                  );
                }

                const session = row.sessions[rotation];
                if (!session)
                  return (
                    <NotScheduledCell
                      key={rotation}
                      label={`${row.name} is not scheduled for ${ROTATION_LABELS[rotation]}`}
                    />
                  );

                const assignment = session.assignments[rotation];
                // Absences need no handling here: resolveSessionCoverage has
                // already subtracted them, so a teacher who stepped back is
                // simply not one of these two.
                const teacherIds = [assignment?.t1, assignment?.t2].filter(
                  (id): id is string => Boolean(id)
                );

                return (
                  <div key={rotation} className={CELL_SHELL}>
                    {teacherIds.length > 0 ? (
                      teacherIds.map((id) => (
                        <TeacherLine key={id} name={nameById.get(id)} />
                      ))
                    ) : (
                      <Unlisted>No teacher listed</Unlisted>
                    )}

                    {/* Stated per cell only when the row cannot state it once:
                        an unlinked club's rotations can sit in different rooms,
                        and a row header claiming one of them would be wrong for
                        the others. */}
                    {row.roomName === null && session.roomName && (
                      <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">
                        {session.roomName}
                      </p>
                    )}
                    {row.roomName === null && !session.roomName && (
                      <Unlisted className="mt-1">Room not assigned</Unlisted>
                    )}

                    {/* Per cell, not per row: an unlinked club's rotations have
                        separate sign-up lists, so one number on the left would
                        be three different numbers' worth of wrong. */}
                    <p className="mt-1 text-xs tabular-nums text-gray-400 dark:text-gray-500">
                      {session.studentCount}{" "}
                      {session.studentCount === 1 ? "student" : "students"}
                    </p>
                  </div>
                );
              })}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

function TeacherLine({ name }: { name: string | undefined }) {
  return (
    <p className="truncate text-sm font-medium text-gray-900 dark:text-white">
      {/* A teacher who has since been deleted leaves their id behind in an old
          coverage row. Naming the state beats printing a cuid at somebody. */}
      {name ?? "Unknown staff member"}
    </p>
  );
}

/**
 * Something the day has not decided yet.
 *
 * Grey and italic rather than red: on the admin Coverage page an empty slot is a
 * job, and the colour is the prompt to do it. Here it is only a fact, and
 * colouring a fact somebody cannot act on trains them to ignore the colour.
 */
function Unlisted({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p className={`text-sm italic text-gray-400 dark:text-gray-500 ${className}`}>
      {children}
    </p>
  );
}
