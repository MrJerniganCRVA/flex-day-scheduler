import type { RotationSlot } from "@prisma/client";

/**
 * Pure planning logic for enrolling a club's required members.
 *
 * Kept free of any Prisma import for the same reason as src/lib/reconcile.ts:
 * src/lib/prisma.ts throws without DATABASE_URL, and these rules are worth
 * testing without a database standing behind them. `enrollRequiredMembers` in
 * src/lib/required-members-io.ts loads the rows and applies these decisions.
 *
 * The rules encode one policy decision: **a required signup wins.** A student
 * whose attendance at Yearbook is mandatory is in that room whether or not the
 * room is nominally full and whether or not they had already chosen something
 * else for that rotation. So capacity is reported, not enforced, and a
 * conflicting *voluntary* signup is displaced. The one thing never resolved
 * automatically is a collision with another club's *forced* signup: two clubs
 * both requiring the same student at the same time is a mistake in the
 * requirements, and quietly picking a winner would hide it.
 */

/** A session a required member could be placed into. */
export interface EnrollTargetSession {
  id: string;
  sessionName: string;
  rotations: RotationSlot[];
  flexDayId: string;
  flexDayDate: Date;
  flexDayFinalized: boolean;
  /** capacityOverride ?? club.maxCapacity, resolved by the caller. */
  capacity: number;
  enrolledCount: number;
}

/** An existing signup held by one of the students being enrolled. */
export interface ExistingSignup {
  id: string;
  studentId: string;
  clubSessionId: string;
  flexDayId: string;
  rotations: RotationSlot[];
  sessionName: string;
  forced: boolean;
}

export interface EnrollmentPlan {
  /** Signups to create, all with forced = true. */
  toCreate: { studentId: string; clubSessionId: string }[];
  /**
   * Signups that already exist but were chosen voluntarily and now need their
   * forced flag set. Distinct from toCreate because the unique constraint on
   * (studentId, clubSessionId) makes a create impossible here.
   */
  toPromote: { signupId: string; studentId: string }[];
  /** Voluntary signups cancelled to free a rotation. Each gets an audit row. */
  toDisplace: {
    signupId: string;
    studentId: string;
    clubSessionId: string;
    sessionName: string;
    rotations: RotationSlot[];
    /**
     * The session whose required enrollment pushed this one out. Recorded here
     * rather than re-derived later: a student can be displaced on several flex
     * days in one pass, and the audit row has to name the right day.
     */
    displacedBySessionId: string;
  }[];
  /** Sessions taken past capacity. Enrolled anyway; the teacher is told. */
  overCapacity: {
    clubSessionId: string;
    sessionName: string;
    capacity: number;
    newCount: number;
  }[];
  /** Finalized or past flex days, left alone. Reported so nobody is surprised. */
  skipped: {
    clubSessionId: string;
    sessionName: string;
    flexDayId: string;
    flexDayDate: Date;
    reason: "flex-day-finalized" | "flex-day-past";
  }[];
  /** Sessions where the student was already correctly enrolled. */
  alreadyEnrolled: number;
}

/**
 * Raised when two clubs both require the same student in the same rotation.
 * Deliberately a throw rather than another report field: there is no correct
 * automatic outcome, and the caller must not half-apply a plan around it.
 */
export class RequiredMemberConflictError extends Error {
  constructor(
    readonly studentId: string,
    readonly sessionName: string,
    readonly otherSessionName: string,
    readonly rotations: RotationSlot[]
  ) {
    super(`Already required at ${otherSessionName}, which overlaps ${sessionName}.`);
    this.name = "RequiredMemberConflictError";
  }
}

/** Whether two rotation lists share any slot. */
function overlaps(a: RotationSlot[], b: RotationSlot[]): boolean {
  return a.some((r) => b.includes(r));
}

/**
 * Decide what enrolling `studentIds` into `sessions` should do.
 *
 * `today` is injected rather than read from the clock so tests can pin it — the
 * same reason `planReconcile` takes `flexDayDate` from its caller.
 */
export function planRequiredEnrollment(params: {
  sessions: EnrollTargetSession[];
  studentIds: string[];
  /** Every signup those students hold on the flex days in play. */
  existingSignups: ExistingSignup[];
  today: Date;
}): EnrollmentPlan {
  const { sessions, studentIds, existingSignups, today } = params;

  const plan: EnrollmentPlan = {
    toCreate: [],
    toPromote: [],
    toDisplace: [],
    overCapacity: [],
    skipped: [],
    alreadyEnrolled: 0,
  };

  // Signups indexed by student and flex day: every conflict question is asked
  // within a single day, and rescanning the whole list per session turns
  // quadratic once a club has a year of flex days on the books.
  const key = (studentId: string, flexDayId: string) => `${studentId} ${flexDayId}`;
  const byStudentDay = new Map<string, ExistingSignup[]>();
  for (const s of existingSignups) {
    const k = key(s.studentId, s.flexDayId);
    const list = byStudentDay.get(k);
    if (list) list.push(s);
    else byStudentDay.set(k, [s]);
  }

  // Running counts, so enrolling several students at once reports the capacity
  // the session actually ends at rather than the one it started from.
  const counts = new Map(sessions.map((s) => [s.id, s.enrolledCount]));
  const displacedIds = new Set<string>();

  for (const session of sessions) {
    if (session.flexDayFinalized || session.flexDayDate < today) {
      plan.skipped.push({
        clubSessionId: session.id,
        sessionName: session.sessionName,
        flexDayId: session.flexDayId,
        flexDayDate: session.flexDayDate,
        reason: session.flexDayFinalized ? "flex-day-finalized" : "flex-day-past",
      });
      continue;
    }

    for (const studentId of studentIds) {
      const daySignups = (
        byStudentDay.get(key(studentId, session.flexDayId)) ?? []
      ).filter((s) => !displacedIds.has(s.id));

      const here = daySignups.find((s) => s.clubSessionId === session.id);
      if (here) {
        if (here.forced) plan.alreadyEnrolled += 1;
        else plan.toPromote.push({ signupId: here.id, studentId });
        continue;
      }

      // Anything else the student holds that overlaps this session's rotations.
      const clashes = daySignups.filter(
        (s) =>
          s.clubSessionId !== session.id && overlaps(s.rotations, session.rotations)
      );

      const forcedClash = clashes.find((c) => c.forced);
      if (forcedClash) {
        throw new RequiredMemberConflictError(
          studentId,
          session.sessionName,
          forcedClash.sessionName,
          session.rotations.filter((r) => forcedClash.rotations.includes(r))
        );
      }

      for (const c of clashes) {
        displacedIds.add(c.id);
        plan.toDisplace.push({
          signupId: c.id,
          studentId,
          clubSessionId: c.clubSessionId,
          sessionName: c.sessionName,
          rotations: c.rotations,
          displacedBySessionId: session.id,
        });
        counts.set(c.clubSessionId, (counts.get(c.clubSessionId) ?? 1) - 1);
      }

      plan.toCreate.push({ studentId, clubSessionId: session.id });
      counts.set(session.id, (counts.get(session.id) ?? 0) + 1);
    }

    const newCount = counts.get(session.id) ?? 0;
    if (newCount > session.capacity) {
      plan.overCapacity.push({
        clubSessionId: session.id,
        sessionName: session.sessionName,
        capacity: session.capacity,
        newCount,
      });
    }
  }

  return plan;
}

/** Whether a plan changes anything at all. */
export function planIsEmpty(plan: EnrollmentPlan): boolean {
  return (
    plan.toCreate.length === 0 &&
    plan.toPromote.length === 0 &&
    plan.toDisplace.length === 0
  );
}
