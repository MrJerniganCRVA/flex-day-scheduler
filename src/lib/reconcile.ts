import type { RotationSlot } from "@prisma/client";

/**
 * Pure planning logic for reshaping a club's future sessions.
 *
 * Kept free of any Prisma import so the rules are directly unit-testable —
 * src/lib/prisma.ts throws without DATABASE_URL, which would otherwise make every
 * test of this file need a database it has no use for. `reconcileFutureSessions`
 * in src/lib/scheduling.ts applies these decisions.
 */

/**
 * The session shapes a club's defaults imply: one session spanning every default
 * rotation when linked, otherwise one session per rotation.
 */
export function desiredSessionShapes(club: {
  defaultRotations: RotationSlot[];
  linkedRotations: boolean;
}): RotationSlot[][] {
  if (club.defaultRotations.length === 0) return [];
  return club.linkedRotations
    ? [[...club.defaultRotations].sort()]
    : [...club.defaultRotations].sort().map((r) => [r]);
}

/** Order-insensitive comparison of two rotation sets. */
function sameRotations(a: RotationSlot[], b: RotationSlot[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((r, i) => r === sortedB[i]);
}

export type ReconcileSkip = {
  sessionId: string;
  rotations: RotationSlot[];
  flexDayDate: Date;
  reason: "has-signups" | "flex-day-finalized" | "has-calendar-event";
};

export type ReconcileReport = {
  created: number;
  deleted: number;
  flexDaysTouched: number;
  skipped: ReconcileSkip[];
};

type ReconcileSession = {
  id: string;
  rotations: RotationSlot[];
  googleEventId: string | null;
  _count: { signups: number };
};

/**
 * Decide what to change on one flex day, given the sessions a club currently has
 * there and the shapes its defaults imply. Pure, so the rules are testable
 * without a database.
 *
 * Deletion is deliberately conservative: a session is only removed when nothing
 * would be lost with it. Anything carrying signups, holding a calendar event, or
 * sitting on a finalized day is reported instead, for a human to decide. Silently
 * destroying a student's placement to make a club's shape tidy is not a trade
 * this should make on its own.
 */
export function planReconcile(params: {
  existing: ReconcileSession[];
  desired: RotationSlot[][];
  flexDayFinalized: boolean;
  flexDayDate: Date;
}): {
  toCreate: RotationSlot[][];
  toDelete: string[];
  skipped: ReconcileSkip[];
} {
  const { existing, desired, flexDayFinalized, flexDayDate } = params;

  const unmatchedExisting = [...existing];
  const toCreate: RotationSlot[][] = [];

  // Pair each desired shape with an existing session that already has it.
  for (const shape of desired) {
    const idx = unmatchedExisting.findIndex((s) =>
      sameRotations(s.rotations, shape)
    );
    if (idx === -1) toCreate.push(shape);
    else unmatchedExisting.splice(idx, 1);
  }

  const toDelete: string[] = [];
  const skipped: ReconcileSkip[] = [];

  for (const session of unmatchedExisting) {
    const reason: ReconcileSkip["reason"] | null =
      session._count.signups > 0
        ? "has-signups"
        : flexDayFinalized
          ? "flex-day-finalized"
          : session.googleEventId !== null
            ? "has-calendar-event"
            : null;

    if (reason) {
      skipped.push({
        sessionId: session.id,
        rotations: session.rotations,
        flexDayDate,
        reason,
      });
    } else {
      toDelete.push(session.id);
    }
  }

  return { toCreate, toDelete, skipped };
}
