import { describe, it, expect } from "vitest";
import {
  planRequiredEnrollment,
  planIsEmpty,
  RequiredMemberConflictError,
  type EnrollTargetSession,
  type ExistingSignup,
} from "./required-members";

/**
 * The policy under test: a required signup wins. Capacity is reported rather
 * than enforced, a conflicting voluntary signup is displaced, and only a clash
 * with another club's *forced* signup stops the plan.
 */

const TODAY = new Date("2026-09-02T00:00:00.000Z");
const NEXT_WEEK = new Date("2026-09-09T00:00:00.000Z");
const LAST_WEEK = new Date("2026-08-26T00:00:00.000Z");

const session = (
  over: Partial<EnrollTargetSession> & Pick<EnrollTargetSession, "id">
): EnrollTargetSession => ({
  sessionName: "Yearbook",
  rotations: ["FLEX_1"],
  flexDayId: "day1",
  flexDayDate: NEXT_WEEK,
  flexDayFinalized: false,
  capacity: 20,
  enrolledCount: 0,
  ...over,
});

const signup = (
  over: Partial<ExistingSignup> & Pick<ExistingSignup, "id" | "clubSessionId">
): ExistingSignup => ({
  studentId: "stu1",
  flexDayId: "day1",
  rotations: ["FLEX_1"],
  sessionName: "Chess Club",
  forced: false,
  ...over,
});

const plan = (
  sessions: EnrollTargetSession[],
  existingSignups: ExistingSignup[] = [],
  studentIds = ["stu1"]
) => planRequiredEnrollment({ sessions, studentIds, existingSignups, today: TODAY });

describe("planRequiredEnrollment", () => {
  it("enrolls a student into an empty future session", () => {
    const p = plan([session({ id: "s1" })]);

    expect(p.toCreate).toEqual([{ studentId: "stu1", clubSessionId: "s1" }]);
    expect(p.toDisplace).toHaveLength(0);
    expect(p.overCapacity).toHaveLength(0);
    expect(p.skipped).toHaveLength(0);
    expect(planIsEmpty(p)).toBe(false);
  });

  it("skips a finalized flex day, because its invites have already gone out", () => {
    const p = plan([session({ id: "s1", flexDayFinalized: true })]);

    expect(p.toCreate).toHaveLength(0);
    expect(p.skipped).toEqual([
      expect.objectContaining({ clubSessionId: "s1", reason: "flex-day-finalized" }),
    ]);
    expect(planIsEmpty(p)).toBe(true);
  });

  it("skips a flex day in the past", () => {
    const p = plan([session({ id: "s1", flexDayDate: LAST_WEEK })]);

    expect(p.toCreate).toHaveLength(0);
    expect(p.skipped[0]).toMatchObject({ reason: "flex-day-past" });
  });

  it("treats today as future, not past", () => {
    const p = plan([session({ id: "s1", flexDayDate: TODAY })]);

    expect(p.skipped).toHaveLength(0);
    expect(p.toCreate).toHaveLength(1);
  });

  it("is a no-op when the student is already forced into the session", () => {
    const p = plan(
      [session({ id: "s1" })],
      [signup({ id: "sg1", clubSessionId: "s1", forced: true })]
    );

    expect(p.toCreate).toHaveLength(0);
    expect(p.toPromote).toHaveLength(0);
    expect(p.alreadyEnrolled).toBe(1);
    expect(planIsEmpty(p)).toBe(true);
  });

  it("promotes rather than duplicates when the student had already signed up voluntarily", () => {
    // The unique constraint on (studentId, clubSessionId) makes a create
    // impossible here; the signup just changes hands.
    const p = plan(
      [session({ id: "s1" })],
      [signup({ id: "sg1", clubSessionId: "s1", forced: false })]
    );

    expect(p.toCreate).toHaveLength(0);
    expect(p.toPromote).toEqual([{ signupId: "sg1", studentId: "stu1" }]);
    expect(p.toDisplace).toHaveLength(0);
  });

  it("displaces a voluntary signup that occupies the same rotation", () => {
    const p = plan(
      [session({ id: "s1", rotations: ["FLEX_1"] })],
      [signup({ id: "sg1", clubSessionId: "other", rotations: ["FLEX_1"] })]
    );

    expect(p.toDisplace).toEqual([
      expect.objectContaining({ signupId: "sg1", sessionName: "Chess Club" }),
    ]);
    expect(p.toCreate).toEqual([{ studentId: "stu1", clubSessionId: "s1" }]);
  });

  it("leaves a voluntary signup in a different rotation alone", () => {
    const p = plan(
      [session({ id: "s1", rotations: ["FLEX_1"] })],
      [signup({ id: "sg1", clubSessionId: "other", rotations: ["FLEX_2"] })]
    );

    expect(p.toDisplace).toHaveLength(0);
    expect(p.toCreate).toHaveLength(1);
  });

  it("leaves a signup on a different flex day alone", () => {
    const p = plan(
      [session({ id: "s1", flexDayId: "day1" })],
      [signup({ id: "sg1", clubSessionId: "other", flexDayId: "day2" })]
    );

    expect(p.toDisplace).toHaveLength(0);
  });

  it("displaces on any overlapping rotation of a linked multi-rotation session", () => {
    const p = plan(
      [session({ id: "s1", rotations: ["FLEX_1", "FLEX_2", "FLEX_3"] })],
      [signup({ id: "sg1", clubSessionId: "other", rotations: ["FLEX_2"] })]
    );

    expect(p.toDisplace).toHaveLength(1);
  });

  it("refuses to pick a winner between two clubs that both require the student", () => {
    expect(() =>
      plan(
        [session({ id: "s1", sessionName: "Yearbook", rotations: ["FLEX_1"] })],
        [
          signup({
            id: "sg1",
            clubSessionId: "other",
            rotations: ["FLEX_1"],
            sessionName: "Student Council",
            forced: true,
          }),
        ]
      )
    ).toThrow(RequiredMemberConflictError);
  });

  it("names both clubs in that conflict, so the teacher knows where to look", () => {
    try {
      plan(
        [session({ id: "s1", sessionName: "Yearbook" })],
        [
          signup({
            id: "sg1",
            clubSessionId: "other",
            sessionName: "Student Council",
            forced: true,
          }),
        ]
      );
      expect.unreachable("should have thrown");
    } catch (e) {
      const err = e as RequiredMemberConflictError;
      expect(err.sessionName).toBe("Yearbook");
      expect(err.otherSessionName).toBe("Student Council");
      expect(err.rotations).toEqual(["FLEX_1"]);
    }
  });

  it("enrolls past capacity but reports the overflow", () => {
    const p = plan([session({ id: "s1", capacity: 2, enrolledCount: 2 })]);

    expect(p.toCreate).toHaveLength(1);
    expect(p.overCapacity).toEqual([
      expect.objectContaining({ clubSessionId: "s1", capacity: 2, newCount: 3 }),
    ]);
  });

  it("does not report overflow when the session still has room", () => {
    const p = plan([session({ id: "s1", capacity: 3, enrolledCount: 2 })]);

    expect(p.overCapacity).toHaveLength(0);
  });

  it("counts every student in one pass when reporting capacity", () => {
    const p = plan(
      [session({ id: "s1", capacity: 2, enrolledCount: 1 })],
      [],
      ["stu1", "stu2", "stu3"]
    );

    expect(p.toCreate).toHaveLength(3);
    expect(p.overCapacity[0]).toMatchObject({ capacity: 2, newCount: 4 });
  });

  it("credits a displacement back to the session it was taken from", () => {
    // stu1 leaves "other" for "s1", so "other" ends one lighter than it started.
    const p = plan(
      [session({ id: "s1" })],
      [
        signup({
          id: "sg1",
          studentId: "stu1",
          clubSessionId: "other",
          rotations: ["FLEX_1"],
        }),
      ]
    );

    expect(p.toDisplace).toHaveLength(1);
    expect(p.overCapacity).toHaveLength(0);
  });

  it("attributes each displacement to the session that caused it", () => {
    // One student, two flex days, displaced on both. The audit row for each has
    // to name the day it happened on, so the Changes tab files it correctly.
    const p = plan(
      [
        session({ id: "yb1", flexDayId: "day1" }),
        session({ id: "yb2", flexDayId: "day2" }),
      ],
      [
        signup({ id: "sg1", clubSessionId: "chess1", flexDayId: "day1" }),
        signup({ id: "sg2", clubSessionId: "chess2", flexDayId: "day2" }),
      ]
    );

    expect(p.toDisplace).toHaveLength(2);
    expect(
      p.toDisplace.map((d) => [d.signupId, d.displacedBySessionId])
    ).toEqual([
      ["sg1", "yb1"],
      ["sg2", "yb2"],
    ]);
  });

  it("plans several students across several sessions", () => {
    const p = plan(
      [
        session({ id: "s1", flexDayId: "day1" }),
        session({ id: "s2", flexDayId: "day2" }),
      ],
      [],
      ["stu1", "stu2"]
    );

    expect(p.toCreate).toHaveLength(4);
  });

  it("does nothing at all when the club has no sessions", () => {
    const p = plan([]);

    expect(planIsEmpty(p)).toBe(true);
    expect(p.alreadyEnrolled).toBe(0);
  });
});
