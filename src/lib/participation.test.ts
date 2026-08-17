import { describe, it, expect } from "vitest";
import {
  dayCoverage,
  rotationStats,
  sessionCapacity,
  type ParticipationSession,
} from "./participation";

/**
 * Regression tests for the three defects that made the admin dashboard's
 * headline figure meaningless: signups counted as students, capacity precedence
 * reversed, and linked sessions counted once per rotation and then summed.
 */

function session(
  rotations: ParticipationSession["rotations"],
  studentIds: string[],
  opts: { capacityOverride?: number | null; maxCapacity?: number | null } = {}
): ParticipationSession {
  return {
    rotations,
    capacityOverride: opts.capacityOverride ?? null,
    club:
      opts.maxCapacity === null || opts.maxCapacity === undefined
        ? null
        : { maxCapacity: opts.maxCapacity },
    signups: studentIds.map((studentId) => ({ studentId })),
  };
}

describe("sessionCapacity", () => {
  it("prefers the per-day override over the club default", () => {
    // The dashboard previously read these the other way round, so an override
    // was ignored whenever the session belonged to a club.
    expect(
      sessionCapacity(session(["FLEX_1"], [], { capacityOverride: 5, maxCapacity: 20 }))
    ).toBe(5);
  });

  it("falls back to the club default when there is no override", () => {
    expect(sessionCapacity(session(["FLEX_1"], [], { maxCapacity: 20 }))).toBe(20);
  });

  it("is zero when neither is set", () => {
    expect(sessionCapacity(session(["FLEX_1"], []))).toBe(0);
  });

  it("uses the override for a one-off session, which has no club", () => {
    expect(
      sessionCapacity(session(["FLEX_2"], [], { capacityOverride: 12 }))
    ).toBe(12);
  });
});

describe("rotationStats", () => {
  it("counts a linked session in each rotation it occupies", () => {
    // One session spanning all three rotations genuinely occupies all three.
    const linked = session(["FLEX_1", "FLEX_2", "FLEX_3"], ["s1", "s2"], {
      maxCapacity: 20,
    });
    const stats = rotationStats([linked]);
    for (const stat of stats) {
      expect(stat.sessionCount).toBe(1);
      expect(stat.studentsPlaced).toBe(2);
      expect(stat.capacity).toBe(20);
    }
  });

  it("counts distinct students, not signup rows", () => {
    // Two separate sessions in the same rotation, one student in each, plus a
    // student in both would be impossible in practice — but the count must be
    // over distinct ids regardless.
    const a = session(["FLEX_1"], ["s1", "s2"], { maxCapacity: 10 });
    const b = session(["FLEX_1"], ["s2", "s3"], { maxCapacity: 10 });
    const [flex1] = rotationStats([a, b]);
    expect(flex1.studentsPlaced).toBe(3);
    expect(flex1.capacity).toBe(20);
  });

  it("reports zero for a rotation with no sessions", () => {
    const stats = rotationStats([session(["FLEX_1"], ["s1"], { maxCapacity: 5 })]);
    const flex3 = stats.find((s) => s.slot === "FLEX_3")!;
    expect(flex3.sessionCount).toBe(0);
    expect(flex3.studentsPlaced).toBe(0);
    expect(flex3.capacity).toBe(0);
  });
});

describe("dayCoverage", () => {
  it("does not inflate a linked session's students threefold", () => {
    // The original bug: one 20-seat linked club with 12 students reported
    // "36/60 — 60% filled" because per-rotation buckets were summed. The
    // percentage looked plausible precisely because both halves were 3x.
    const students = Array.from({ length: 12 }, (_, i) => `s${i}`);
    const linked = session(["FLEX_1", "FLEX_2", "FLEX_3"], students, {
      maxCapacity: 20,
    });

    const coverage = dayCoverage([linked], 100);
    expect(coverage.studentsWithAnySignup).toBe(12);
    expect(coverage.fullyPlaced).toBe(12);
    expect(coverage.partiallyPlaced).toBe(0);
    expect(coverage.unplaced).toBe(88);

    // And the summed-bucket figure it replaced would have been 36.
    const summedBuckets = rotationStats([linked]).reduce(
      (sum, r) => sum + r.studentsPlaced,
      0
    );
    expect(summedBuckets).toBe(36);
    expect(coverage.studentsWithAnySignup).not.toBe(summedBuckets);
  });

  it("separates fully placed from partly placed students", () => {
    const sessions = [
      session(["FLEX_1"], ["all", "partial"], { maxCapacity: 30 }),
      session(["FLEX_2"], ["all"], { maxCapacity: 30 }),
      session(["FLEX_3"], ["all"], { maxCapacity: 30 }),
    ];
    const coverage = dayCoverage(sessions, 5);
    expect(coverage.fullyPlaced).toBe(1); // "all" has all three
    expect(coverage.partiallyPlaced).toBe(1); // "partial" has only FLEX_1
    expect(coverage.unplaced).toBe(3); // 5 students, 2 have signups
    expect(coverage.needingSlots).toBe(4); // 1 partial + 3 unplaced
  });

  it("treats a student in one linked session as fully placed", () => {
    const coverage = dayCoverage(
      [session(["FLEX_1", "FLEX_2", "FLEX_3"], ["s1"], { maxCapacity: 5 })],
      1
    );
    expect(coverage.fullyPlaced).toBe(1);
    expect(coverage.needingSlots).toBe(0);
  });

  it("reports everyone unplaced when there are no sessions", () => {
    const coverage = dayCoverage([], 240);
    expect(coverage.unplaced).toBe(240);
    expect(coverage.needingSlots).toBe(240);
    expect(coverage.studentsWithAnySignup).toBe(0);
  });

  it("never reports a negative unplaced count", () => {
    // Defensive: more signed-up students than the current STUDENT count, e.g.
    // after someone's role changed. A negative number on a dashboard is worse
    // than a clamped one.
    const coverage = dayCoverage(
      [session(["FLEX_1"], ["s1", "s2", "s3"], { maxCapacity: 10 })],
      1
    );
    expect(coverage.unplaced).toBe(0);
    expect(coverage.needingSlots).toBeGreaterThanOrEqual(0);
  });
});
