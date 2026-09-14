import type { RotationSlot } from "@prisma/client";
import { ALL_ROTATIONS } from "@/types";

/**
 * Pure planning logic for an admin rewriting one student's placement on one
 * Flex Day.
 *
 * Kept free of any Prisma import for the same reason as src/lib/reconcile.ts
 * and src/lib/required-members.ts: src/lib/prisma.ts throws without
 * DATABASE_URL, and this is the part worth testing without a database standing
 * behind it. POST /api/admin/student-signups loads the rows and applies these
 * decisions.
 *
 * The input is *declarative* — "Flex 1 should end up as this session" — rather
 * than a list of moves. That matters because the admin is editing three
 * dropdowns at once and the interesting cases are the ones where a naive
 * op-by-op application fails: swapping two rotations, or moving into a session
 * the student is about to vacate. Working from the desired end state makes
 * those ordinary.
 *
 * Two policy decisions are encoded here, and they differ from the single-op
 * override in POST /api/admin/roster on purpose:
 *
 *  - **Capacity is reported, not enforced.** Same rule as required members: a
 *    stated room capacity does not stop an admin who has decided a particular
 *    student has to be in a particular room. The caller decides whether to
 *    require confirmation.
 *  - **A rotation conflict is fatal.** A student cannot be in two rooms at
 *    once. That is a physical fact rather than a policy, so there is no force
 *    flag for it.
 */

/** A session on the Flex Day being edited. */
export interface ScheduleSession {
  id: string;
  /** title ?? club.name ?? "Session", resolved by the caller. */
  sessionName: string;
  rotations: RotationSlot[];
  /** capacityOverride ?? club.maxCapacity ?? 0, resolved by the caller. */
  capacity: number;
  enrolledCount: number;
}

/** One signup the student currently holds on that day. */
export interface ScheduleSignup {
  signupId: string;
  clubSessionId: string;
  forced: boolean;
}

/**
 * The desired end state, per rotation.
 *
 * An absent key means "leave that rotation as it is"; an explicit null means
 * "empty it". The distinction matters for a caller that edits one rotation of
 * a day without sending the other two.
 */
export type DesiredSlots = Partial<Record<RotationSlot, string | null>>;

export interface ScheduleOp {
  action: "ADD" | "MOVE" | "REMOVE";
  /** Present for MOVE and REMOVE. */
  fromSignupId?: string;
  fromSessionId?: string;
  fromSessionName?: string;
  /** Present for MOVE and ADD. */
  toSessionId?: string;
  toSessionName?: string;
  /** The rotations this op accounts for. Display, and MOVE pairing. */
  rotations: RotationSlot[];
  /**
   * True when the signup being given up was a required-member signup. Not a
   * refusal — the admin may well be making exactly that exception — but the UI
   * says so, because the membership outlives the override and
   * src/lib/required-members-io.ts will re-enroll the student on the club's
   * next session.
   */
  droppingForced?: boolean;
}

export interface OverCapacitySession {
  clubSessionId: string;
  sessionName: string;
  capacity: number;
  /** Headcount the session lands at if this plan is applied. */
  newCount: number;
}

export interface SchedulePlan {
  /**
   * Every op that gives a session up precedes every op that takes one, so a
   * swap frees its own rotation before the add re-checks it. The caller
   * applies them in this order.
   */
  ops: ScheduleOp[];
  /** Sessions taken past capacity. Planned anyway; the admin is told. */
  overCapacity: OverCapacitySession[];
  unchanged: boolean;
}

/**
 * What GET /api/admin/student-signups sends the editor.
 *
 * Declared here rather than in the route because a route.ts may only export
 * handlers, and the client component needs the shape. Kept alongside the
 * planner so the wire format and the rules it feeds cannot drift apart.
 */
export interface StudentScheduleDay {
  flexDayId: string;
  /** YYYY-MM-DD. */
  date: string;
  label: string | null;
  isFinalized: boolean;
  /** False for past days, which render read-only. */
  editable: boolean;
  /** Empty for past days — nothing there is selectable. */
  sessions: (ScheduleSession & { hasCalendarEvent: boolean })[];
  signups: {
    signupId: string;
    clubSessionId: string;
    sessionName: string;
    rotations: RotationSlot[];
    forced: boolean;
  }[];
}

export interface StudentScheduleLookup {
  student: { id: string; name: string; email: string };
  days: StudentScheduleDay[];
}

/**
 * The student would be in two places at once. Deliberately a throw rather than
 * a report field, like RequiredMemberConflictError: there is no correct
 * automatic outcome and the caller must not half-apply a plan around it.
 */
export class ScheduleConflictError extends Error {
  constructor(
    readonly rotation: RotationSlot,
    readonly sessionName: string,
    readonly otherSessionName: string
  ) {
    super(
      `${sessionName} and ${otherSessionName} both cover the same rotation.`
    );
    this.name = "ScheduleConflictError";
  }
}

/**
 * The requested end state contradicts itself — a session covering Flex 1 and
 * Flex 2 was asked for in Flex 1 while Flex 2 was asked to hold something
 * else, or to be empty.
 *
 * The editor prevents this by writing a multi-rotation session's id into every
 * rotation it covers and disabling those rows, so this is unreachable from the
 * UI. It is checked anyway because the route is a public JSON endpoint and a
 * contradictory body would otherwise be resolved silently, in whichever
 * direction the iteration order happened to fall.
 */
export class ScheduleInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScheduleInputError";
  }
}

/** Rotations shared by two sessions. */
function sharedRotations(a: RotationSlot[], b: RotationSlot[]): RotationSlot[] {
  return a.filter((r) => b.includes(r));
}

/** Sorted into timetable order, so op rotations read F1, F2, F3. */
function inRotationOrder(rotations: Iterable<RotationSlot>): RotationSlot[] {
  const present = new Set(rotations);
  return ALL_ROTATIONS.filter((r) => present.has(r));
}

/**
 * Decide what changing `desired` should do to the student's signups.
 *
 * `sessions` must be every session on the one Flex Day in play, and
 * `currentSignups` every signup the student holds on it — both are needed
 * whole, because a rotation the admin did not touch still occupies the
 * timetable and still has to be checked against.
 */
export function planStudentSchedule(params: {
  sessions: ScheduleSession[];
  currentSignups: ScheduleSignup[];
  desired: DesiredSlots;
}): SchedulePlan {
  const { sessions, currentSignups, desired } = params;

  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const signupBySessionId = new Map(
    currentSignups.map((s) => [s.clubSessionId, s])
  );

  // ── Where the student stands now, rotation by rotation ──────────────────
  const currentByRotation = new Map<RotationSlot, string>();
  for (const signup of currentSignups) {
    const session = sessionById.get(signup.clubSessionId);
    // A signup whose session isn't in `sessions` means the caller loaded the
    // two from different days. Better to say so than to plan against half a
    // timetable and silently drop the rest.
    if (!session) {
      throw new ScheduleInputError(
        "A signup was passed whose session is not on this Flex Day."
      );
    }
    for (const rotation of session.rotations) {
      currentByRotation.set(rotation, session.id);
    }
  }

  // ── Where the admin wants them, rotation by rotation ────────────────────
  //
  // Start from the current placement so an absent key means "leave it alone",
  // then overlay what was actually asked for.
  const targetByRotation = new Map(currentByRotation);
  for (const rotation of ALL_ROTATIONS) {
    if (!(rotation in desired)) continue;
    const sessionId = desired[rotation];
    if (sessionId == null) {
      targetByRotation.delete(rotation);
      continue;
    }
    const session = sessionById.get(sessionId);
    if (!session) {
      throw new ScheduleInputError(
        "A session was chosen that is not on this Flex Day."
      );
    }
    if (!session.rotations.includes(rotation)) {
      throw new ScheduleInputError(
        `${session.sessionName} does not run in that rotation.`
      );
    }
    targetByRotation.set(rotation, sessionId);
  }

  // A multi-rotation session claims every rotation it covers. Asking for it in
  // one of them while asking for something else — or nothing — in another is a
  // contradiction, not a preference to be resolved.
  for (const sessionId of [...targetByRotation.values()]) {
    const session = sessionById.get(sessionId)!;
    for (const covered of session.rotations) {
      const other = targetByRotation.get(covered);
      if (other === sessionId) continue;
      if (other === undefined) {
        if (covered in desired) {
          throw new ScheduleInputError(
            `${session.sessionName} covers ${covered}, so that rotation cannot also be left empty.`
          );
        }
        // The rotation was never mentioned and is currently free: the linked
        // session simply fills it.
        targetByRotation.set(covered, sessionId);
        continue;
      }
      throw new ScheduleConflictError(
        covered,
        session.sessionName,
        sessionById.get(other)!.sessionName
      );
    }
  }

  // ── Reduce both sides to session sets, and diff ─────────────────────────
  const targetIds = new Set(targetByRotation.values());
  const currentIds = new Set(currentByRotation.values());

  const droppedIds = [...currentIds].filter((id) => !targetIds.has(id));
  const addedIds = [...targetIds].filter((id) => !currentIds.has(id));

  if (droppedIds.length === 0 && addedIds.length === 0) {
    return { ops: [], overCapacity: [], unchanged: true };
  }

  // ── Pair drops with adds that share a rotation, to make a MOVE ──────────
  //
  // Without this pairing the audit trail would read as an unrelated REMOVE
  // plus ADD, losing the "out of X, into Y" that SignupAudit.fromSessionName
  // and toSessionName exist to record — which is the one thing someone
  // re-reading the Changes tab actually wants to know.
  const unpairedDrops = [...droppedIds];
  const moves: { fromId: string; toId: string; rotations: RotationSlot[] }[] =
    [];
  const unpairedAdds: string[] = [];

  for (const toId of addedIds) {
    const to = sessionById.get(toId)!;
    const matchIndex = unpairedDrops.findIndex((fromId) => {
      const from = sessionById.get(fromId)!;
      return sharedRotations(from.rotations, to.rotations).length > 0;
    });
    if (matchIndex === -1) {
      unpairedAdds.push(toId);
      continue;
    }
    const [fromId] = unpairedDrops.splice(matchIndex, 1);
    const from = sessionById.get(fromId)!;
    moves.push({
      fromId,
      toId,
      rotations: inRotationOrder([...from.rotations, ...to.rotations]),
    });
  }

  // ── Emit, drops before adds ─────────────────────────────────────────────
  const ops: ScheduleOp[] = [];

  for (const fromId of unpairedDrops) {
    const from = sessionById.get(fromId)!;
    const signup = signupBySessionId.get(fromId)!;
    ops.push({
      action: "REMOVE",
      fromSignupId: signup.signupId,
      fromSessionId: fromId,
      fromSessionName: from.sessionName,
      rotations: inRotationOrder(from.rotations),
      ...(signup.forced ? { droppingForced: true } : {}),
    });
  }

  for (const move of moves) {
    const from = sessionById.get(move.fromId)!;
    const to = sessionById.get(move.toId)!;
    const signup = signupBySessionId.get(move.fromId)!;
    ops.push({
      action: "MOVE",
      fromSignupId: signup.signupId,
      fromSessionId: move.fromId,
      fromSessionName: from.sessionName,
      toSessionId: move.toId,
      toSessionName: to.sessionName,
      rotations: move.rotations,
      ...(signup.forced ? { droppingForced: true } : {}),
    });
  }

  for (const toId of unpairedAdds) {
    const to = sessionById.get(toId)!;
    ops.push({
      action: "ADD",
      toSessionId: toId,
      toSessionName: to.sessionName,
      rotations: inRotationOrder(to.rotations),
    });
  }

  // ── Capacity, reported against the count each session lands at ──────────
  //
  // Counted from enrolledCount rather than re-derived, and only for sessions
  // being joined: a session the student is already in cannot be pushed over by
  // a plan that leaves them there, and reporting it would be noise on every
  // edit to a popular club.
  const overCapacity: OverCapacitySession[] = [];
  for (const toId of targetIds) {
    if (currentIds.has(toId)) continue;
    const to = sessionById.get(toId)!;
    const newCount = to.enrolledCount + 1;
    if (newCount > to.capacity) {
      overCapacity.push({
        clubSessionId: toId,
        sessionName: to.sessionName,
        capacity: to.capacity,
        newCount,
      });
    }
  }

  return { ops, overCapacity, unchanged: false };
}
