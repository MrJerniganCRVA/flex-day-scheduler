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
  const covered = new Map<string, Set<RotationSlot>>();
  for (const s of sessions) {
    for (const { studentId } of s.signups) {
      const set = covered.get(studentId) ?? new Set<RotationSlot>();
      for (const r of s.rotations) set.add(r);
      covered.set(studentId, set);
    }
  }

  let fullyPlaced = 0;
  let partiallyPlaced = 0;
  for (const rotations of covered.values()) {
    if (rotations.size >= ALL_ROTATIONS.length) fullyPlaced++;
    else partiallyPlaced++;
  }

  const studentsWithAnySignup = covered.size;
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
