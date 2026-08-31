import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { RotationSlot } from "@prisma/client";
import { rosterOverrideSchema } from "@/lib/validations";
import {
  addAttendeeToEvent,
  getOneOffCalendarId,
  removeAttendeeFromEvent,
} from "@/lib/google-calendar";
import {
  MAX_TX_ATTEMPTS,
  conflictBackoffMs,
  isSerializationConflict,
  sleep,
} from "@/lib/tx-retry";

/**
 * POST /api/admin/roster — admin roster override.
 *
 * The normal signup rules are deliberately strict: students sign up themselves,
 * and everything closes at the Friday deadline. But real situations need an
 * exception (a student turns up without the permission slip a club requires),
 * and before this route existed there was no way to make one — POST /api/signups
 * rejects every non-student, the admin flex-day rosters were read-only, and the
 * student's own controls are past their deadline. The only recourse was editing
 * Postgres by hand.
 *
 * This is that exception, kept deliberately narrow:
 *  - ADMIN only. Teachers keep read-only rosters.
 *  - Bypasses the signup deadline and the finalized flag, because that is the
 *    entire point.
 *  - Still enforces capacity and rotation conflicts. Those are physical facts
 *    about rooms and timetables, not policy — an override that ignored them
 *    would put a real student in an overfull room or in two places at once. The
 *    Serializable-with-retry pattern is the same one POST /api/signups uses, so
 *    an override racing a student signup can't overbook.
 *  - Writes a SignupAudit row inside the same transaction, with a required
 *    reason.
 *
 * Calendar reconciliation is targeted: the affected student is removed from the
 * old event and added to the new one with sendUpdates:"all", rather than
 * unfinalizing and re-finalizing the whole day, which would re-notify every
 * student on every session over one student's change.
 */

type SessionForOverride = {
  id: string;
  rotations: RotationSlot[];
  capacityOverride: number | null;
  googleEventId: string | null;
  clubId: string | null;
  title: string | null;
  flexDayId: string;
  flexDay: { id: string; date: Date };
  club: { name: string; maxCapacity: number; googleCalendarId: string | null } | null;
};

const sessionSelect = {
  id: true,
  rotations: true,
  capacityOverride: true,
  googleEventId: true,
  clubId: true,
  title: true,
  flexDayId: true,
  flexDay: { select: { id: true, date: true } },
  club: { select: { name: true, maxCapacity: true, googleCalendarId: true } },
} as const;

const displayName = (s: SessionForOverride) =>
  s.title ?? s.club?.name ?? "Session";

/** Calendar work to perform after the transaction commits. */
type CalendarOp =
  | { op: "remove"; calendarId: string; eventId: string; email: string }
  | { op: "add"; calendarId: string; eventId: string; email: string };

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = rosterOverrideSchema.safeParse(body);
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
          const calendarOps: CalendarOp[] = [];

          // ── Resolve the student and the session being left, if any ─────────
          let studentId: string;
          let fromSession: SessionForOverride | null = null;

          if (input.action === "add") {
            studentId = input.studentId;
          } else {
            const signup = await tx.signup.findUnique({
              where: { id: input.signupId },
              select: {
                studentId: true,
                clubSession: { select: sessionSelect },
              },
            });
            if (!signup) {
              throw Object.assign(new Error("SIGNUP_NOT_FOUND"), { status: 404 });
            }
            studentId = signup.studentId;
            fromSession = signup.clubSession;
          }

          const student = await tx.user.findUnique({
            where: { id: studentId },
            select: { id: true, name: true, email: true, role: true },
          });
          if (!student || student.role !== "STUDENT") {
            throw Object.assign(new Error("STUDENT_NOT_FOUND"), { status: 404 });
          }

          // ── Resolve the destination session, if any ─────────────────────────
          let toSession: SessionForOverride | null = null;
          if (input.action === "move" || input.action === "add") {
            toSession = await tx.clubSession.findUnique({
              where: { id: input.toClubSessionId },
              select: sessionSelect,
            });
            if (!toSession) {
              throw Object.assign(new Error("SESSION_NOT_FOUND"), { status: 404 });
            }
            if (
              input.action === "move" &&
              fromSession &&
              toSession.flexDayId !== fromSession.flexDayId
            ) {
              // Moving across days would silently change which day a student is
              // committed to; that's a different operation, not an override.
              throw Object.assign(new Error("CROSS_FLEX_DAY"), { status: 400 });
            }
          }

          // ── Remove the old signup first, so a move frees its own rotation ───
          if (input.action === "move" || input.action === "remove") {
            await tx.signup.delete({ where: { id: input.signupId } });

            if (fromSession?.googleEventId && student.email) {
              const calendarId = await resolveCalendarId(fromSession);
              if (calendarId) {
                calendarOps.push({
                  op: "remove",
                  calendarId,
                  eventId: fromSession.googleEventId,
                  email: student.email,
                });
              }
            }
          }

          // ── Add the new signup, enforcing the physical constraints ──────────
          if (toSession) {
            const maxCapacity =
              toSession.capacityOverride ?? toSession.club?.maxCapacity ?? 0;
            const currentCount = await tx.signup.count({
              where: { clubSessionId: toSession.id },
            });
            if (currentCount >= maxCapacity) {
              throw Object.assign(new Error("CAPACITY_FULL"), { status: 409 });
            }

            const sameDaySignups = await tx.signup.findMany({
              where: {
                studentId,
                clubSession: { flexDayId: toSession.flexDayId },
              },
              select: { clubSession: { select: { rotations: true } } },
            });
            const occupied = new Set(
              sameDaySignups.flatMap((s) => s.clubSession.rotations)
            );
            const conflicts = toSession.rotations.filter((r) => occupied.has(r));
            if (conflicts.length > 0) {
              throw Object.assign(new Error("ROTATION_CONFLICT"), {
                status: 409,
                rotations: conflicts,
              });
            }

            await tx.signup.create({
              data: { studentId, clubSessionId: toSession.id },
            });

            if (toSession.googleEventId && student.email) {
              const calendarId = await resolveCalendarId(toSession);
              if (calendarId) {
                calendarOps.push({
                  op: "add",
                  calendarId,
                  eventId: toSession.googleEventId,
                  email: student.email,
                });
              }
            }
          }

          // ── Audit, in the same transaction as the change it describes ───────
          const anchor = toSession ?? fromSession!;
          await tx.signupAudit.create({
            data: {
              action:
                input.action === "move"
                  ? "MOVE"
                  : input.action === "add"
                    ? "ADD"
                    : "REMOVE",
              reason: input.reason,
              actorId,
              actorEmail,
              studentId: student.id,
              studentName: student.name,
              fromSessionId: fromSession?.id ?? null,
              fromSessionName: fromSession ? displayName(fromSession) : null,
              toSessionId: toSession?.id ?? null,
              toSessionName: toSession ? displayName(toSession) : null,
              flexDayId: anchor.flexDay.id,
              flexDayDate: anchor.flexDay.date,
            },
          });

          return {
            calendarOps,
            studentName: student.name,
            fromName: fromSession ? displayName(fromSession) : null,
            toName: toSession ? displayName(toSession) : null,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );

      // Calendar work happens after commit — a Google API hiccup must not roll
      // back a roster change the admin has already been told about, and the
      // reverse (committing after a successful send) would risk the student
      // holding an invite for a signup that doesn't exist.
      for (const op of result.calendarOps) {
        const fn = op.op === "add" ? addAttendeeToEvent : removeAttendeeFromEvent;
        await fn({
          calendarId: op.calendarId,
          eventId: op.eventId,
          studentEmail: op.email,
          sendUpdates: "all",
        }).catch((err) =>
          console.error(
            `Roster override committed, but the calendar ${op.op} for ${op.email} on event ${op.eventId} failed:`,
            err
          )
        );
      }

      return NextResponse.json({
        ok: true,
        action: input.action,
        student: result.studentName,
        from: result.fromName,
        to: result.toName,
        calendarUpdates: result.calendarOps.length,
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

      const err = error as Error & { status?: number; rotations?: string[] };
      switch (err.message) {
        case "SIGNUP_NOT_FOUND":
          return NextResponse.json(
            { error: "That signup no longer exists — the roster may have changed." },
            { status: 404 }
          );
        case "STUDENT_NOT_FOUND":
          return NextResponse.json(
            { error: "Student not found" },
            { status: 404 }
          );
        case "SESSION_NOT_FOUND":
          return NextResponse.json(
            { error: "Destination session not found" },
            { status: 404 }
          );
        case "CROSS_FLEX_DAY":
          return NextResponse.json(
            {
              error:
                "A student can only be moved between sessions on the same Flex Day.",
            },
            { status: 400 }
          );
        case "CAPACITY_FULL":
          return NextResponse.json(
            {
              error:
                "That session is full. Raise its capacity override first, or pick another.",
            },
            { status: 409 }
          );
        case "ROTATION_CONFLICT":
          return NextResponse.json(
            {
              error:
                "The student is already booked in one of that session's rotations.",
              conflicts: err.rotations,
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
      throw error;
    }
  }

  // Unreachable: every iteration returns or throws.
  throw new Error("Unreachable");
}

/**
 * The calendar a session's event lives on. Club sessions use their club's
 * calendar; one-off sessions use the shared host calendar, read without
 * creating one (nothing to reconcile if it was never provisioned).
 */
async function resolveCalendarId(
  session: SessionForOverride
): Promise<string | null> {
  if (session.clubId === null) return getOneOffCalendarId();
  return session.club?.googleCalendarId ?? null;
}
