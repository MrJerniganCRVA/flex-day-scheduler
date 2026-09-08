import type { RotationSlot } from "@prisma/client";
import { ALL_ROTATIONS } from "@/types";

/**
 * Participation and coverage statistics for a flex day.
 *
 * The distinction this module exists to keep straight: a **signup** is one row,
 * a **student** is a person, and one student can hold up to three signups on a
 * day (one per rotation). Conflating the two is what made the admin dashboard's
 * headline number meaningless — it reported summed signups against summed club
 * capacity, a figure far larger than the school's student population.
 *
 * The second trap is per-rotation bucketing. A *linked* session spans several
 * rotations, so bucketing sessions by rotation and then summing the buckets
 * counts that session once per rotation. With linkedRotations defaulting to
 * true, a single 20-seat club with 12 students signed up produced a headline of
 * "36/60" — the percentage looked right precisely because both halves were
 * inflated 3×. Anything "overall" must therefore be computed over distinct
 * students and distinct sessions, never by summing per-rotation figures.
 */

/** Minimal session shape these helpers need. */
export type ParticipationSession = {
  rotations: RotationSlot[];
  capacityOverride: number | null;
  club: { maxCapacity: number } | null;
  signups: { studentId: string }[];
};

/**
 * Seats available in a session. The per-day override wins over the club default,
 * matching every other capacity calculation in the app — reversing these two is
 * a bug that has appeared here more than once.
 */
export function sessionCapacity(s: ParticipationSession): number {
  return s.capacityOverride ?? s.club?.maxCapacity ?? 0;
}

export type RotationStat = {
  slot: RotationSlot;
  /** Sessions running in this rotation. */
  sessionCount: number;
  /** Distinct students with a signup covering this rotation. */
  studentsPlaced: number;
  /** Seats offered in this rotation. */
  capacity: number;
};

/** Per-rotation placement and capacity. */
export function rotationStats(
  sessions: ParticipationSession[]
): RotationStat[] {
  return ALL_ROTATIONS.map((slot) => {
    const inRotation = sessions.filter((s) =>
      s.rotations.includes(slot as RotationSlot)
    );
    const students = new Set<string>();
    for (const s of inRotation) {
      for (const signup of s.signups) students.add(signup.studentId);
    }
    return {
      slot: slot as RotationSlot,
      sessionCount: inRotation.length,
      studentsPlaced: students.size,
      capacity: inRotation.reduce((sum, s) => sum + sessionCapacity(s), 0),
    };
  });
}

/**
 * Rotations a student's signups cover.
 *
 * Takes the rotation lists rather than signup rows so both shapes of query can
 * use it: the dashboard reads sessions-with-their-signups, the user list reads
 * signups-with-their-session. A linked session contributes all its rotations at
 * once, which is why this is a Set and not a count of rows.
 */
export function coveredRotations(
  sessionRotations: RotationSlot[][]
): Set<RotationSlot> {
  const covered = new Set<RotationSlot>();
  for (const rotations of sessionRotations) {
    for (const r of rotations) covered.add(r);
  }
  return covered;
}

export type Placement =
  /** A signup covering every rotation. */
  | { kind: "full" }
  /** Some rotations covered; `missing` names the empty ones, in slot order. */
  | { kind: "partial"; missing: RotationSlot[] }
  /** No signups at all that day. */
  | { kind: "none" };

/**
 * The single answer to "is this student placed?".
 *
 * Exported so the admin user list renders the same verdict `dayCoverage` counts
 * and auto-assign acts on. Those three had drifted: the user list asked only
 * whether *any* signup existed, so a student who lost one of three sessions to a
 * deleted club still showed as "Signed up" while auto-assign was correctly
 * queueing them for a replacement.
 */
export function placementOf(covered: Set<RotationSlot>): Placement {
  const missing = ALL_ROTATIONS.filter((r) => !covered.has(r));
  if (missing.length === 0) return { kind: "full" };
  if (missing.length === ALL_ROTATIONS.length) return { kind: "none" };
  return { kind: "partial", missing };
}

export type DayCoverage = {
  /** Students with a signup in every rotation. */
  fullyPlaced: number;
  /** Students with signups in some but not all rotations. */
  partiallyPlaced: number;
  /** Students with no signup at all that day. */
  unplaced: number;
  /** partiallyPlaced + unplaced — everyone auto-assign still has work for. */
  needingSlots: number;
  /** Distinct students with at least one signup that day. */
  studentsWithAnySignup: number;
};

/**
 * How many students still have an empty rotation — the question an admin
 * actually needs answered before a flex day, and the one auto-assign exists to
 * resolve. Computed over distinct students, so linked sessions can't inflate it.
 */
export function dayCoverage(
  sessions: ParticipationSession[],
  totalStudents: number
): DayCoverage {
  const byStudent = new Map<string, RotationSlot[][]>();
  for (const s of sessions) {
    for (const { studentId } of s.signups) {
      const held = byStudent.get(studentId) ?? [];
      held.push(s.rotations);
      byStudent.set(studentId, held);
    }
  }

  let fullyPlaced = 0;
  let partiallyPlaced = 0;
  for (const held of byStudent.values()) {
    // Deliberately routed through placementOf rather than comparing sizes here:
    // this tally and the per-student badge must always agree, and they only
    // disagreed in the first place because each had its own copy of the rule.
    // Everyone in this map holds a signup, so "none" is unreachable.
    if (placementOf(coveredRotations(held)).kind === "full") fullyPlaced++;
    else partiallyPlaced++;
  }

  const studentsWithAnySignup = byStudent.size;
  // Clamped: a stale totalStudents (or a signup from a since-demoted student)
  // must not produce a negative count on a dashboard.
  const unplaced = Math.max(0, totalStudents - studentsWithAnySignup);

  return {
    fullyPlaced,
    partiallyPlaced,
    unplaced,
    needingSlots: partiallyPlaced + unplaced,
    studentsWithAnySignup,
  };
}
