import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { studentScheduleUpdateSchema } from "@/lib/validations";
import { allowedEmailDomain, classifyAllowedEmail } from "@/lib/email-domain";
import {
  applyAttendeeOps,
  resolveSessionCalendarId,
  type AttendeeOp,
} from "@/lib/session-calendar";
import {
  planStudentSchedule,
  ScheduleConflictError,
  ScheduleInputError,
  type DesiredSlots,
  type OverCapacitySession,
  type ScheduleSession,
} from "@/lib/student-schedule";
import {
  MAX_TX_ATTEMPTS,
  conflictBackoffMs,
  isSerializationConflict,
  sleep,
} from "@/lib/tx-retry";

/**
 * The admin "edit a student's signups" screen.
 *
 * GET looks a student up by email and returns their placement across every
 * Flex Day still ahead of them. POST rewrites it.
 *
 * This exists alongside POST /api/admin/roster rather than replacing it. That
 * route is session-first — reached from a session's roster on the Flex Day
 * page, one signup at a time — and it hard-blocks capacity. This one is
 * student-first, rewrites a whole day at once, and lets an admin force past a
 * full room after confirming. Both bypass the signup deadline and the
 * finalized flag, because that is the entire point of an override.
 *
 * Nothing here is conditional on the day being finalized. A session that has
 * not had invites sent has no `googleEventId`, so the calendar step simply
 * finds nothing to do — which is what makes this usable before the deadline as
 * well as after it.
 */

const PAST_DAYS_SHOWN = 5;

/** Midnight UTC today, the convention every other date query in the app uses. */
function startOfToday(): Date {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return today;
}

const sessionSelect = {
  id: true,
  title: true,
  rotations: true,
  capacityOverride: true,
  googleEventId: true,
  clubId: true,
  club: { select: { name: true, maxCapacity: true, googleCalendarId: true } },
  _count: { select: { signups: true } },
} as const;

type SessionRow = Prisma.ClubSessionGetPayload<{ select: typeof sessionSelect }>;

const displayName = (s: { title: string | null; club: { name: string } | null }) =>
  s.title ?? s.club?.name ?? "Session";

const resolveCapacity = (s: {
  capacityOverride: number | null;
  club: { maxCapacity: number } | null;
}) => s.capacityOverride ?? s.club?.maxCapacity ?? 0;

/** The planner's view of a session, from a loaded row. */
function toScheduleSession(s: SessionRow): ScheduleSession {
  return {
    id: s.id,
    sessionName: displayName(s),
    rotations: s.rotations,
    capacity: resolveCapacity(s),
    enrolledCount: s._count.signups,
  };
}

// ───────────────────────────── GET: look a student up ─────────────────────

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("email")?.trim() ?? "";
  if (!raw) {
    return NextResponse.json(
      { error: "Enter a student's email address." },
      { status: 400 }
    );
  }

  // Stored addresses are always lowercase — src/auth.ts and the CSV import both
  // lowercase before writing — so an exact match is both correct and the only
  // form that uses User.@@index([email]).
  const typed = raw.toLowerCase();
  const candidates = [typed];

  // An admin reading off a class list types "jdoe27", not the whole address.
  if (!typed.includes("@")) {
    const domain = allowedEmailDomain();
    if (domain) candidates.push(`${typed}@students.${domain}`);
  }

  const user = await prisma.user.findFirst({
    where: { email: { in: candidates } },
    select: { id: true, name: true, email: true, role: true },
  });

  if (!user) {
    return NextResponse.json({ error: notFoundMessage(typed) }, { status: 404 });
  }
  if (user.role !== "STUDENT") {
    return NextResponse.json(
      {
        error: `${user.name} is a ${user.role.toLowerCase()}, not a student. This screen edits student signups.`,
      },
      { status: 404 }
    );
  }

  const today = startOfToday();

  const [editableDays, pastDays, signups] = await Promise.all([
    prisma.flexDay.findMany({
      where: { date: { gte: today }, isActive: true },
      orderBy: { date: "asc" },
      select: {
        id: true,
        date: true,
        label: true,
        isFinalized: true,
        clubSessions: { select: sessionSelect },
      },
    }),
    // Past days carry no selectable sessions, so they are loaded without one —
    // and bounded, because they grow without limit and this screen cannot
    // change them.
    prisma.flexDay.findMany({
      where: { date: { lt: today } },
      orderBy: { date: "desc" },
      take: PAST_DAYS_SHOWN,
      select: { id: true, date: true, label: true, isFinalized: true },
    }),
    prisma.signup.findMany({
      where: { studentId: user.id },
      select: {
        id: true,
        forced: true,
        clubSession: {
          select: {
            id: true,
            title: true,
            rotations: true,
            flexDayId: true,
            club: { select: { name: true } },
          },
        },
      },
    }),
  ]);

  const signupsByDay = new Map<string, typeof signups>();
  for (const s of signups) {
    const list = signupsByDay.get(s.clubSession.flexDayId);
    if (list) list.push(s);
    else signupsByDay.set(s.clubSession.flexDayId, [s]);
  }

  const asSignupPayload = (day: string) =>
    (signupsByDay.get(day) ?? []).map((s) => ({
      signupId: s.id,
      clubSessionId: s.clubSession.id,
      sessionName: displayName(s.clubSession),
      rotations: s.clubSession.rotations,
      forced: s.forced,
    }));

  return NextResponse.json({
    student: { id: user.id, name: user.name, email: user.email },
    days: [
      ...editableDays.map((day) => ({
        flexDayId: day.id,
        date: day.date.toISOString().split("T")[0],
        label: day.label,
        isFinalized: day.isFinalized,
        editable: true,
        sessions: day.clubSessions
          .map((s) => ({
            id: s.id,
            sessionName: displayName(s),
            rotations: s.rotations,
            capacity: resolveCapacity(s),
            enrolledCount: s._count.signups,
            hasCalendarEvent: s.googleEventId !== null,
          }))
          .sort((a, b) => a.sessionName.localeCompare(b.sessionName)),
        signups: asSignupPayload(day.id),
      })),
      ...pastDays.map((day) => ({
        flexDayId: day.id,
        date: day.date.toISOString().split("T")[0],
        label: day.label,
        isFinalized: day.isFinalized,
        editable: false,
        sessions: [],
        signups: asSignupPayload(day.id),
      })),
    ],
  });
}

/**
 * Why an address found nothing. Three different mistakes that a bare "not
 * found" would flatten into one: a staff address typed on the student screen,
 * an address from outside the school entirely, and a real student who has
 * simply never signed in and so has no row yet.
 */
function notFoundMessage(email: string): string {
  switch (classifyAllowedEmail(email)) {
    case "teacher":
      return "That's a staff address. This screen edits student signups.";
    case "outside":
      return "That address isn't at the school's domain, so it can't have an account here.";
    default:
      return "No account for that address. They may never have signed in — import them on the Users page first, then try again.";
  }
}

// ───────────────────────────── POST: apply the change ─────────────────────

/** Thrown inside the transaction and mapped to a response outside it. */
type TaggedError = Error & {
  overCapacity?: OverCapacitySession[];
  detail?: string;
};

function tagged(message: string, extra: Partial<TaggedError> = {}): TaggedError {
  return Object.assign(new Error(message), extra);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = studentScheduleUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const input = parsed.data;
  const actorId = session.user.id;
  const actorEmail = session.user.email ?? "unknown";

  for (let attempt = 1; attempt <= MAX_TX_ATTEMPTS; attempt++) {
    try {
      const result = await prisma.$transaction(
        async (tx) => {
          const calendarOps: AttendeeOp[] = [];
          const applied: {
            action: string;
            from: string | null;
            to: string | null;
            date: string;
          }[] = [];
          const forcedOverCapacity: OverCapacitySession[] = [];
          const droppedRequired: string[] = [];

          const student = await tx.user.findUnique({
            where: { id: input.studentId },
            select: { id: true, name: true, email: true, role: true },
          });
          if (!student || student.role !== "STUDENT") {
            throw tagged("STUDENT_NOT_FOUND");
          }

          const today = startOfToday();

          for (const day of input.days) {
            const flexDay = await tx.flexDay.findUnique({
              where: { id: day.flexDayId },
              select: {
                id: true,
                date: true,
                isActive: true,
                clubSessions: { select: sessionSelect },
              },
            });
            if (!flexDay) throw tagged("FLEX_DAY_NOT_FOUND");
            if (!flexDay.isActive || flexDay.date < today) {
              throw tagged("DAY_NOT_EDITABLE");
            }

            const currentSignups = await tx.signup.findMany({
              where: { studentId: student.id, clubSession: { flexDayId: flexDay.id } },
              select: { id: true, clubSessionId: true, forced: true },
            });

            const sessionById = new Map(flexDay.clubSessions.map((s) => [s.id, s]));

            const plan = planStudentSchedule({
              sessions: flexDay.clubSessions.map(toScheduleSession),
              currentSignups: currentSignups.map((s) => ({
                signupId: s.id,
                clubSessionId: s.clubSessionId,
                forced: s.forced,
              })),
              desired: day.slots as DesiredSlots,
            });

            if (plan.overCapacity.length > 0) {
              if (!input.force) {
                throw tagged("NEEDS_FORCE", { overCapacity: plan.overCapacity });
              }
              forcedOverCapacity.push(...plan.overCapacity);
            }

            // Ops arrive with every session given up ahead of every session
            // taken, so a swap frees its own rotation before the create lands.
            for (const op of plan.ops) {
              if (op.fromSignupId) {
                await tx.signup.delete({ where: { id: op.fromSignupId } });

                const from = sessionById.get(op.fromSessionId!)!;
                if (from.googleEventId && student.email) {
                  const calendarId = await resolveSessionCalendarId(from);
                  if (calendarId) {
                    calendarOps.push({
                      op: "remove",
                      calendarId,
                      eventId: from.googleEventId,
                      email: student.email,
                    });
                  }
                }
                if (op.droppingForced && op.fromSessionName) {
                  droppedRequired.push(op.fromSessionName);
                }
              }

              if (op.toSessionId) {
                await tx.signup.create({
                  data: { studentId: student.id, clubSessionId: op.toSessionId },
                });

                const to = sessionById.get(op.toSessionId)!;
                if (to.googleEventId && student.email) {
                  const calendarId = await resolveSessionCalendarId(to);
                  if (calendarId) {
                    calendarOps.push({
                      op: "add",
                      calendarId,
                      eventId: to.googleEventId,
                      email: student.email,
                    });
                  }
                }
              }

              await tx.signupAudit.create({
                data: {
                  action: op.action,
                  reason: input.reason,
                  actorId,
                  actorEmail,
                  studentId: student.id,
                  studentName: student.name,
                  fromSessionId: op.fromSessionId ?? null,
                  fromSessionName: op.fromSessionName ?? null,
                  toSessionId: op.toSessionId ?? null,
                  toSessionName: op.toSessionName ?? null,
                  flexDayId: flexDay.id,
                  flexDayDate: flexDay.date,
                },
              });

              applied.push({
                action: op.action,
                from: op.fromSessionName ?? null,
                to: op.toSessionName ?? null,
                date: flexDay.date.toISOString().split("T")[0],
              });
            }
          }

          return {
            calendarOps,
            applied,
            forcedOverCapacity,
            droppedRequired,
            studentName: student.name,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );

      await applyAttendeeOps(
        result.calendarOps,
        `Signup change for ${result.studentName} committed`
      );

      return NextResponse.json({
        ok: true,
        student: result.studentName,
        applied: result.applied,
        calendarUpdates: result.calendarOps.length,
        forcedOverCapacity: result.forcedOverCapacity,
        droppedRequired: result.droppedRequired,
      });
    } catch (error: unknown) {
      if (isSerializationConflict(error)) {
        if (attempt < MAX_TX_ATTEMPTS) {
          await sleep(conflictBackoffMs(attempt));
          continue;
        }
        return NextResponse.json(
          {
            error:
              "Another change to this roster landed at the same time. Please try again.",
          },
          { status: 409 }
        );
      }

      const mapped = mapError(error);
      if (mapped) return mapped;
      throw error;
    }
  }

  // Unreachable: every iteration returns or throws.
  throw new Error("Unreachable");
}

function mapError(error: unknown): NextResponse | null {
  if (error instanceof ScheduleConflictError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof ScheduleInputError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const err = error as TaggedError;
  switch (err.message) {
    case "STUDENT_NOT_FOUND":
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    case "FLEX_DAY_NOT_FOUND":
      return NextResponse.json(
        { error: "That Flex Day no longer exists." },
        { status: 404 }
      );
    case "DAY_NOT_EDITABLE":
      return NextResponse.json(
        {
          error:
            "That Flex Day is in the past or inactive. Past signups are attendance history and are not editable here.",
        },
        { status: 409 }
      );
    case "NEEDS_FORCE":
      // Not an error so much as a question. The client re-sends with force:true
      // once the admin has confirmed.
      return NextResponse.json(
        {
          error: "One or more sessions would go over capacity.",
          needsForce: true,
          overCapacity: err.overCapacity ?? [],
        },
        { status: 409 }
      );
  }

  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    return NextResponse.json(
      { error: "The student is already signed up for that session." },
      { status: 409 }
    );
  }

  return null;
}
