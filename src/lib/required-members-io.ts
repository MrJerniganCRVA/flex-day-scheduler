import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { RotationSlot } from "@prisma/client";
import {
  planRequiredEnrollment,
  planIsEmpty,
  type EnrollmentPlan,
  type EnrollTargetSession,
  type ExistingSignup,
} from "@/lib/required-members";
import {
  MAX_TX_ATTEMPTS,
  conflictBackoffMs,
  isSerializationConflict,
  sleep,
} from "@/lib/tx-retry";
import {
  getOneOffCalendarId,
  removeAttendeeFromEvent,
} from "@/lib/google-calendar";

export { RequiredMemberConflictError } from "@/lib/required-members";
export type { EnrollmentPlan } from "@/lib/required-members";

/**
 * Database side of required-member enrollment. The rules live next door in
 * src/lib/required-members.ts; this module only loads rows, applies a plan and
 * reconciles Google Calendar.
 *
 * Every mutation runs Serializable with the same retry/backoff as
 * POST /api/signups and the admin roster override, because it competes with
 * both: a student can be signing themselves into the very session a teacher is
 * force-enrolling someone else into, and the capacity numbers this reports would
 * otherwise be read off a stale snapshot.
 */

/** The session fields the planner needs, selected once and reused. */
const targetSessionSelect = {
  id: true,
  title: true,
  rotations: true,
  capacityOverride: true,
  flexDayId: true,
  flexDay: { select: { id: true, date: true, isFinalized: true } },
  club: { select: { name: true, maxCapacity: true } },
  _count: { select: { signups: true } },
} as const;

type LoadedSession = Prisma.ClubSessionGetPayload<{
  select: typeof targetSessionSelect;
}>;

function toTarget(s: LoadedSession): EnrollTargetSession {
  return {
    id: s.id,
    sessionName: s.title ?? s.club?.name ?? "Session",
    rotations: s.rotations,
    flexDayId: s.flexDayId,
    flexDayDate: s.flexDay.date,
    flexDayFinalized: s.flexDay.isFinalized,
    capacity: s.capacityOverride ?? s.club?.maxCapacity ?? 0,
    enrolledCount: s._count.signups,
  };
}

/** Start of today in UTC — flex day dates are stored as @db.Date. */
function startOfToday(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Takes the transaction client, not the global one: this read decides what gets
 * displaced, so running it outside the Serializable transaction that acts on it
 * would reintroduce exactly the race the isolation level is there to stop.
 */
async function loadExistingSignups(
  tx: Prisma.TransactionClient,
  studentIds: string[],
  flexDayIds: string[]
): Promise<ExistingSignup[]> {
  if (studentIds.length === 0 || flexDayIds.length === 0) return [];

  const rows = await tx.signup.findMany({
    where: {
      studentId: { in: studentIds },
      clubSession: { flexDayId: { in: flexDayIds } },
    },
    select: {
      id: true,
      studentId: true,
      clubSessionId: true,
      forced: true,
      clubSession: {
        select: {
          flexDayId: true,
          rotations: true,
          title: true,
          club: { select: { name: true } },
        },
      },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    studentId: r.studentId,
    clubSessionId: r.clubSessionId,
    flexDayId: r.clubSession.flexDayId,
    rotations: r.clubSession.rotations as RotationSlot[],
    sessionName: r.clubSession.title ?? r.clubSession.club?.name ?? "Session",
    forced: r.forced,
  }));
}

/**
 * Enroll a club's required members into sessions.
 *
 * Called from four places — the three session-creation paths in
 * src/lib/scheduling.ts and POST /api/clubs/[clubId]/sessions, plus the moment a
 * student is added to the roster. Pass `sessionIds` to target sessions that were
 * just created; omit it to sweep every future session the club has.
 *
 * `studentIds` likewise narrows to one newly-added student; omitted, it means
 * the club's whole required roster.
 *
 * Returns null when the club has no required members, which is the common case
 * and worth not paying a transaction for.
 */
export async function enrollRequiredMembers(params: {
  clubId: string;
  sessionIds?: string[];
  studentIds?: string[];
  /** Who to record on the audit rows for any displaced voluntary signup. */
  actor?: { id: string | null; email: string };
}): Promise<EnrollmentPlan | null> {
  const { clubId, sessionIds, studentIds: only, actor } = params;

  // The role filter is the same guard isClubManager applies to club ownership,
  // for the same reason: promoting a student to TEACHER does not clear the
  // RequiredMember rows they left behind, and without this a staff member would
  // keep being signed up for a club as though they were still in it. Demote them
  // back and the membership resumes, which is the right answer.
  const studentIds =
    only ??
    (
      await prisma.requiredMember.findMany({
        where: { clubId, student: { role: "STUDENT" } },
        select: { studentId: true },
      })
    ).map((m) => m.studentId);

  if (studentIds.length === 0) return null;

  const today = startOfToday();

  for (let attempt = 1; attempt <= MAX_TX_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const sessions = await tx.clubSession.findMany({
            where: sessionIds
              ? { id: { in: sessionIds } }
              : { clubId, flexDay: { date: { gte: today }, isActive: true } },
            select: targetSessionSelect,
          });
          if (sessions.length === 0) return emptyPlan();

          const targets = sessions.map(toTarget);
          const existing = await loadExistingSignups(tx, studentIds, [
            ...new Set(targets.map((t) => t.flexDayId)),
          ]);

          const plan = planRequiredEnrollment({
            sessions: targets,
            studentIds,
            existingSignups: existing,
            today,
          });

          if (planIsEmpty(plan)) return plan;

          // Displacements first, so a move within one flex day frees its own
          // rotation before the forced signup claims it — same ordering as the
          // admin roster override.
          if (plan.toDisplace.length > 0) {
            await tx.signup.deleteMany({
              where: { id: { in: plan.toDisplace.map((d) => d.signupId) } },
            });
            await writeDisplacementAudits(tx, plan, targets, actor);
          }

          if (plan.toCreate.length > 0) {
            await tx.signup.createMany({
              data: plan.toCreate.map((c) => ({ ...c, forced: true })),
              skipDuplicates: true,
            });
          }

          if (plan.toPromote.length > 0) {
            await tx.signup.updateMany({
              where: { id: { in: plan.toPromote.map((p) => p.signupId) } },
              data: { forced: true },
            });
          }

          return plan;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (error: unknown) {
      if (isSerializationConflict(error) && attempt < MAX_TX_ATTEMPTS) {
        await sleep(conflictBackoffMs(attempt));
        continue;
      }
      throw error;
    }
  }

  // Unreachable: the loop above either returns or rethrows on its last attempt.
  throw new Error("Unreachable");
}

/**
 * Displaced voluntary signups get the same audit trail an admin removal does.
 * A student who chose Chess and finds themselves in Yearbook deserves a record
 * of who did that and why, and SignupAudit is where the rest of the app already
 * looks for that answer.
 */
async function writeDisplacementAudits(
  tx: Prisma.TransactionClient,
  plan: EnrollmentPlan,
  targets: EnrollTargetSession[],
  actor?: { id: string | null; email: string }
) {
  const studentIds = [...new Set(plan.toDisplace.map((d) => d.studentId))];
  const students = await tx.user.findMany({
    where: { id: { in: studentIds } },
    select: { id: true, name: true },
  });
  const nameById = new Map(students.map((s) => [s.id, s.name]));
  const targetById = new Map(targets.map((t) => [t.id, t]));

  for (const d of plan.toDisplace) {
    // The planner records which session's enrollment caused each displacement,
    // so the audit lands on the flex day it actually happened on — a student
    // displaced on several days in one pass would otherwise have every row
    // filed under whichever day came first.
    const anchor = targetById.get(d.displacedBySessionId);
    if (!anchor) continue;

    await tx.signupAudit.create({
      data: {
        action: "REMOVE",
        reason: `Displaced by required membership in ${anchor.sessionName}.`,
        actorId: actor?.id ?? null,
        actorEmail: actor?.email ?? "system",
        studentId: d.studentId,
        studentName: nameById.get(d.studentId) ?? "Unknown student",
        fromSessionId: d.clubSessionId,
        fromSessionName: d.sessionName,
        toSessionId: null,
        toSessionName: null,
        flexDayId: anchor.flexDayId,
        flexDayDate: anchor.flexDayDate,
      },
    });
  }
}

function emptyPlan(): EnrollmentPlan {
  return {
    toCreate: [],
    toPromote: [],
    toDisplace: [],
    overCapacity: [],
    skipped: [],
    alreadyEnrolled: 0,
  };
}

/**
 * Drop a former required member's forced signups on future flex days.
 *
 * Past signups are left exactly as they are: they are attendance history, and
 * rewriting them would change what the register says happened. Voluntary
 * signups are left alone too — if the student separately chose this club, that
 * choice is still theirs.
 *
 * Returns the calendar invites that now need withdrawing. A day finalized after
 * the student was enrolled has already sent them one.
 */
export async function dropFutureForcedSignups(params: {
  clubId: string;
  studentId: string;
}): Promise<{ removed: number; calendarOps: CalendarWithdrawal[] }> {
  const { clubId, studentId } = params;
  const today = startOfToday();

  const doomed = await prisma.signup.findMany({
    where: {
      studentId,
      forced: true,
      clubSession: {
        clubId,
        flexDay: { date: { gte: today } },
      },
    },
    select: {
      id: true,
      student: { select: { email: true } },
      clubSession: {
        select: {
          googleEventId: true,
          clubId: true,
          club: { select: { googleCalendarId: true } },
        },
      },
    },
  });

  if (doomed.length === 0) return { removed: 0, calendarOps: [] };

  const calendarOps: CalendarWithdrawal[] = [];
  for (const s of doomed) {
    const eventId = s.clubSession.googleEventId;
    if (!eventId || !s.student.email) continue;
    const calendarId =
      s.clubSession.clubId === null
        ? await getOneOffCalendarId()
        : (s.clubSession.club?.googleCalendarId ?? null);
    if (calendarId) {
      calendarOps.push({ calendarId, eventId, email: s.student.email });
    }
  }

  const { count } = await prisma.signup.deleteMany({
    where: { id: { in: doomed.map((s) => s.id) } },
  });

  return { removed: count, calendarOps };
}

export interface CalendarWithdrawal {
  calendarId: string;
  eventId: string;
  email: string;
}

/**
 * Withdraw calendar invites after the database change has committed. A Google
 * hiccup must not roll back a roster change the teacher has already been told
 * about — the same trade-off, and the same ordering, as the admin roster
 * override.
 */
export async function applyCalendarWithdrawals(ops: CalendarWithdrawal[]) {
  for (const op of ops) {
    await removeAttendeeFromEvent({
      calendarId: op.calendarId,
      eventId: op.eventId,
      studentEmail: op.email,
      sendUpdates: "all",
    }).catch((err) =>
      console.error(
        `Required membership ended, but withdrawing the calendar invite for ${op.email} on event ${op.eventId} failed:`,
        err
      )
    );
  }
}
