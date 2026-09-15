import type { RotationSlot } from "@prisma/client";
import { ALL_ROTATIONS } from "@/types";

/**
 * The shape of a Flex Day as a grid — a row per club, a column per rotation —
 * and the rules for folding sessions into those rows.
 *
 * Two screens draw this grid now: the admin Coverage page, where every cell is
 * editable, and the read-only Building board that support staff and teachers
 * read. The rules for *what a row is* are subtle enough (an unlinked club is
 * three database rows and one row here; two sessions of one club in one rotation
 * are two rows) that a second copy would quietly disagree with the first — the
 * same argument src/lib/coverage.ts makes about resolving coverage, and the same
 * one src/lib/my-sessions.ts makes about "the sessions I am attached to".
 *
 * Deliberately free of any Prisma import, like src/lib/reconcile.ts: src/lib/prisma.ts
 * throws without DATABASE_URL, which would make every test of these rules need a
 * database they have no use for. The `import type` above is erased at compile
 * time and costs nothing. The query that produces a `BoardSession` lives next
 * door in src/lib/flex-day-board.ts, which may import Prisma freely because
 * nothing unit-tests it.
 */

/** Effective coverage for one rotation, as resolved by src/lib/coverage.ts. */
export type ResolvedAssignment = {
  t1: string | null;
  t2: string | null;
  /** True when an admin explicitly said this rotation needs no primary teacher. */
  t1Cleared: boolean;
  /** True when an admin explicitly said this rotation needs no second teacher. */
  t2Cleared: boolean;
  /**
   * Teachers already marked absent from this session for this rotation, so the
   * "Not here" control knows whether it is setting or undoing.
   */
  absentTeacherIds: string[];
};

/**
 * What one session's cell needs. Deliberately *not* the raw ingredients of
 * coverage resolution: the owner, cosponsor and coverage rows used to be passed
 * to the Coverage grid so it could derive T1/T2 itself, and that second
 * implementation is exactly why absences never reached that screen. The server
 * resolves now; the grids render.
 */
export type BoardSession = {
  sessionId: string;
  /**
   * Null for a one-off session, which belongs to no club.
   *
   * A club whose rotations are *unlinked* gets one session per rotation, so
   * students can sign up for one, two or three of them independently — see
   * desiredSessionShapes in src/lib/reconcile.ts. Those sessions are separate
   * rows in the database and separate cards on every other screen, but they are
   * one club to anyone reading across the day, so the grid groups by this.
   */
  clubId: string | null;
  name: string;
  /** Labels the "fall back to the owner" option; not used to derive anything. */
  ownerName: string | null;
  /** Labels the "fall back to the cosponsor" option; not used to derive anything. */
  cosponsorName: string | null;
  /** Where it meets, resolved server-side from the override or the club default. */
  roomName: string | null;
  rotations: RotationSlot[];
  studentCount: number;
  /** Server-resolved starting state, per rotation. */
  assignments: Partial<Record<RotationSlot, ResolvedAssignment>>;
};

/**
 * A supervision post that is not a club — see the DutyPost model.
 *
 * `rotations` holds only the rotations the post is required to be staffed for, so
 * a blank slot always means "needs someone" and never "not needed here".
 */
export type BoardDuty = {
  dutyPostId: string;
  name: string;
  location: string | null;
  rotations: RotationSlot[];
  /** teacherId per required rotation; null means unstaffed. */
  assignments: Partial<Record<RotationSlot, string | null>>;
};

/**
 * One line of the grid for a club.
 *
 * It holds a session *per rotation* rather than a single session, because a club
 * with unlinked rotations has one session per rotation — three database rows
 * that are one club to the reader following the day across. Each cell describes
 * whichever session covers its rotation, so the three keep their own rosters,
 * rooms and coverage while sharing a line.
 */
export type BoardRow = {
  key: string;
  name: string;
  /** The room, when every session in the row agrees; null when they differ. */
  roomName: string | null;
  sessions: Partial<Record<RotationSlot, BoardSession>>;
};

/**
 * One line of either grid: a club, or a duty post.
 *
 * The two share a shell — a name column and three rotation cells — and differ
 * only in what fills them, so which of the two a grid is showing stays the
 * grid's business rather than each screen inventing its own union.
 */
export type BoardGridRow =
  | ({ kind: "club" } & BoardRow)
  | { kind: "duty"; key: string; name: string; duty: BoardDuty };

/** Adapt a duty post to a grid row. */
export function dutyRow(duty: BoardDuty): BoardGridRow {
  return {
    kind: "duty",
    key: `duty:${duty.dutyPostId}`,
    name: duty.name,
    duty,
  };
}

/** Adapt a club row to a grid row. */
export function clubRows(sessions: BoardSession[]): BoardGridRow[] {
  return buildBoardRows(sessions).map((row) => ({ kind: "club", ...row }));
}

/**
 * Fold a day's sessions into grid rows.
 *
 * `sessions` is expected to arrive already sorted by name (the loader does it,
 * alphabetically and only alphabetically — see the note there). Rows keep
 * first-encounter order, so the result is still alphabetical.
 */
export function buildBoardRows(sessions: BoardSession[]): BoardRow[] {
  // Sessions of one club collapse into one row.
  //
  // An unlinked club has a session per rotation, and keying rows by session
  // drew it three times — three lines each with one cell filled and two
  // hatched, for a club that is simply running all day. Grouping by club is
  // what makes the row mean "Art Club" rather than "one of Art Club's three
  // sessions".
  //
  // Two sessions of the same club *in the same rotation* cannot share a cell,
  // so they take a second row rather than one quietly winning. Rows keep
  // first-encounter order, so the result is still alphabetical with any such
  // pair adjacent.
  const rows: BoardRow[] = [];
  const byClub = new Map<string, BoardRow[]>();

  for (const session of sessions) {
    // A one-off belongs to no club, so it never merges with anything.
    const siblings = session.clubId ? (byClub.get(session.clubId) ?? []) : [];
    let row = siblings.find((r) =>
      session.rotations.every((rotation) => !r.sessions[rotation])
    );

    if (!row) {
      row = {
        key: session.clubId
          ? `club:${session.clubId}:${siblings.length}`
          : `session:${session.sessionId}`,
        name: session.name,
        roomName: null,
        sessions: {},
      };
      rows.push(row);
      if (session.clubId) byClub.set(session.clubId, [...siblings, row]);
    }

    for (const rotation of session.rotations) row.sessions[rotation] = session;
  }

  // The room belongs on the row only when the row agrees about it. Sessions
  // of one club normally inherit the same default room, but any of them can
  // carry an override, and a row header claiming one room for three sessions
  // held in two would be worse than saying nothing — so when they differ the
  // cells state their own.
  for (const row of rows) {
    const names = new Set(
      ALL_ROTATIONS.map((r) => row.sessions[r]?.roomName).filter(
        (n): n is string => !!n
      )
    );
    row.roomName = names.size === 1 ? [...names][0] : null;
  }

  return rows;
}
