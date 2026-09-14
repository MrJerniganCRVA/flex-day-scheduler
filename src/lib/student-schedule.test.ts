import { describe, it, expect } from "vitest";
import {
  planStudentSchedule,
  ScheduleConflictError,
  ScheduleInputError,
  type ScheduleSession,
  type ScheduleSignup,
} from "./student-schedule";

/**
 * The planner behind the admin "edit a student's signups" screen.
 *
 * This is the only part of that feature that can be tested without a database,
 * and it is where every interesting failure lives: the screen edits three
 * rotations at once, so the cases that matter are the ones a naive op-by-op
 * application gets wrong — swapping two rotations, moving into a session the
 * student is about to leave, and a linked session claiming rotations nobody
 * named. Getting any of those wrong after invites have gone out means a real
 * student holding a calendar invite for a room they are not in.
 */

function session(
  id: string,
  rotations: ScheduleSession["rotations"],
  overrides: Partial<ScheduleSession> = {}
): ScheduleSession {
  return {
    id,
    sessionName: id,
    rotations,
    capacity: 20,
    enrolledCount: 0,
    ...overrides,
  };
}

function signup(
  clubSessionId: string,
  overrides: Partial<ScheduleSignup> = {}
): ScheduleSignup {
  return {
    signupId: `signup-${clubSessionId}`,
    clubSessionId,
    forced: false,
    ...overrides,
  };
}

const chess = session("Chess", ["FLEX_1"]);
const robotics = session("Robotics", ["FLEX_1"]);
const band = session("Band", ["FLEX_2"]);
const choir = session("Choir", ["FLEX_2"]);
const art = session("Art", ["FLEX_3"]);
/** A linked session: one row covering two rotations. */
const esports = session("Esports", ["FLEX_1", "FLEX_2"]);
const allDay = session("AllDay", ["FLEX_1", "FLEX_2", "FLEX_3"]);

const sessions = [chess, robotics, band, choir, art, esports, allDay];

describe("planStudentSchedule", () => {
  it("reports no change when the desired state matches the current one", () => {
    const plan = planStudentSchedule({
      sessions,
      currentSignups: [signup("Chess")],
      desired: { FLEX_1: "Chess" },
    });

    expect(plan.unchanged).toBe(true);
    expect(plan.ops).toEqual([]);
  });

  it("reports no change when nothing is asked for at all", () => {
    const plan = planStudentSchedule({
      sessions,
      currentSignups: [signup("Chess")],
      desired: {},
    });

    expect(plan.unchanged).toBe(true);
  });

  it("turns a swap within one rotation into a single MOVE", () => {
    const plan = planStudentSchedule({
      sessions,
      currentSignups: [signup("Chess")],
      desired: { FLEX_1: "Robotics" },
    });

    expect(plan.unchanged).toBe(false);
    expect(plan.ops).toHaveLength(1);
    expect(plan.ops[0]).toMatchObject({
      action: "MOVE",
      fromSignupId: "signup-Chess",
      fromSessionId: "Chess",
      fromSessionName: "Chess",
      toSessionId: "Robotics",
      toSessionName: "Robotics",
      rotations: ["FLEX_1"],
    });
  });

  it("emits a REMOVE when a rotation is emptied", () => {
    const plan = planStudentSchedule({
      sessions,
      currentSignups: [signup("Chess")],
      desired: { FLEX_1: null },
    });

    expect(plan.ops).toHaveLength(1);
    expect(plan.ops[0]).toMatchObject({
      action: "REMOVE",
      fromSignupId: "signup-Chess",
      fromSessionId: "Chess",
    });
    expect(plan.ops[0].toSessionId).toBeUndefined();
  });

  it("emits an ADD when an empty rotation is filled", () => {
    const plan = planStudentSchedule({
      sessions,
      currentSignups: [],
      desired: { FLEX_1: "Chess" },
    });

    expect(plan.ops).toHaveLength(1);
    expect(plan.ops[0]).toMatchObject({
      action: "ADD",
      toSessionId: "Chess",
      rotations: ["FLEX_1"],
    });
    expect(plan.ops[0].fromSignupId).toBeUndefined();
  });

  it("leaves rotations the caller did not mention alone", () => {
    const plan = planStudentSchedule({
      sessions,
      currentSignups: [signup("Chess"), signup("Band")],
      desired: { FLEX_1: "Robotics" },
    });

    expect(plan.ops).toHaveLength(1);
    expect(plan.ops[0]).toMatchObject({ action: "MOVE", toSessionId: "Robotics" });
  });

  describe("linked sessions", () => {
    it("fills every rotation a chosen session covers, even unnamed ones", () => {
      const plan = planStudentSchedule({
        sessions,
        currentSignups: [],
        desired: { FLEX_1: "Esports" },
      });

      expect(plan.ops).toHaveLength(1);
      expect(plan.ops[0]).toMatchObject({
        action: "ADD",
        toSessionId: "Esports",
        rotations: ["FLEX_1", "FLEX_2"],
      });
    });

    it("accepts the same session named in each rotation it covers", () => {
      const plan = planStudentSchedule({
        sessions,
        currentSignups: [],
        desired: { FLEX_1: "Esports", FLEX_2: "Esports" },
      });

      expect(plan.ops).toHaveLength(1);
      expect(plan.ops[0]).toMatchObject({ toSessionId: "Esports" });
    });

    it("produces one op, not two, when a linked session replaces two singles", () => {
      const plan = planStudentSchedule({
        sessions,
        currentSignups: [signup("Chess"), signup("Band")],
        desired: { FLEX_1: "Esports", FLEX_2: "Esports" },
      });

      const actions = plan.ops.map((o) => o.action);
      expect(actions).toEqual(["REMOVE", "MOVE"]);
      expect(plan.ops[1]).toMatchObject({
        action: "MOVE",
        toSessionId: "Esports",
      });
      // Whichever of the two it paired with, the other is given up outright.
      expect(plan.ops[0].action).toBe("REMOVE");
    });

    it("rejects a linked session asked for alongside something else", () => {
      expect(() =>
        planStudentSchedule({
          sessions,
          currentSignups: [],
          desired: { FLEX_1: "Esports", FLEX_2: "Band" },
        })
      ).toThrow(ScheduleConflictError);
    });

    it("rejects a linked session whose other rotation is explicitly emptied", () => {
      expect(() =>
        planStudentSchedule({
          sessions,
          currentSignups: [],
          desired: { FLEX_1: "Esports", FLEX_2: null },
        })
      ).toThrow(ScheduleInputError);
    });

    it("rejects a linked session landing on a rotation already occupied", () => {
      // The editor auto-fills, so this only reaches the planner from a
      // hand-written request body. Displacing Band silently would be the wrong
      // answer to an ambiguous ask.
      expect(() =>
        planStudentSchedule({
          sessions,
          currentSignups: [signup("Band")],
          desired: { FLEX_1: "Esports" },
        })
      ).toThrow(ScheduleConflictError);
    });
  });

  describe("conflicts", () => {
    it("refuses two different sessions in the same rotation", () => {
      expect(() =>
        planStudentSchedule({
          sessions,
          currentSignups: [],
          desired: { FLEX_1: "Chess", FLEX_2: "Esports" },
        })
      ).toThrow(ScheduleConflictError);
    });

    it("names both sessions and the rotation they clash in", () => {
      try {
        planStudentSchedule({
          sessions,
          currentSignups: [],
          desired: { FLEX_1: "Esports", FLEX_2: "Band" },
        });
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ScheduleConflictError);
        const conflict = error as ScheduleConflictError;
        expect(conflict.rotation).toBe("FLEX_2");
        expect([conflict.sessionName, conflict.otherSessionName].sort()).toEqual(
          ["Band", "Esports"]
        );
      }
    });

    it("does not treat a straight swap as a conflict", () => {
      const plan = planStudentSchedule({
        sessions,
        currentSignups: [signup("Chess")],
        desired: { FLEX_1: "Robotics" },
      });
      expect(plan.ops).toHaveLength(1);
    });

    it("rejects a session chosen for a rotation it does not run in", () => {
      expect(() =>
        planStudentSchedule({
          sessions,
          currentSignups: [],
          desired: { FLEX_3: "Chess" },
        })
      ).toThrow(ScheduleInputError);
    });

    it("rejects a session that is not on this Flex Day", () => {
      expect(() =>
        planStudentSchedule({
          sessions,
          currentSignups: [],
          desired: { FLEX_1: "SomeOtherDay" },
        })
      ).toThrow(ScheduleInputError);
    });

    it("rejects a signup whose session is not on this Flex Day", () => {
      // Guards against the caller loading signups and sessions from different
      // days, which would otherwise plan against half a timetable.
      expect(() =>
        planStudentSchedule({
          sessions,
          currentSignups: [signup("SomeOtherDay")],
          desired: { FLEX_1: "Chess" },
        })
      ).toThrow(ScheduleInputError);
    });
  });

  describe("ordering", () => {
    it("puts every op that gives a session up before every op that takes one", () => {
      // Chess and Band both go; AllDay arrives. Applied in the wrong order the
      // create would collide with the rotations the deletes are about to free.
      const plan = planStudentSchedule({
        sessions,
        currentSignups: [signup("Chess"), signup("Band")],
        desired: { FLEX_1: "AllDay", FLEX_2: "AllDay", FLEX_3: "AllDay" },
      });

      const lastGiveUp = plan.ops.findLastIndex(
        (o) => o.action === "REMOVE" || o.action === "MOVE"
      );
      const firstPureAdd = plan.ops.findIndex((o) => o.action === "ADD");
      if (firstPureAdd !== -1) {
        expect(lastGiveUp).toBeLessThan(firstPureAdd);
      }
      expect(plan.ops.every((o) => o.action !== "ADD" || o.toSessionId)).toBe(true);
    });

    it("handles rotations swapping places between two sessions", () => {
      // Esports (F1+F2) out, Chess (F1) and Band (F2) in. One pairs into a
      // MOVE; the other is a plain ADD, and must come after it.
      const plan = planStudentSchedule({
        sessions,
        currentSignups: [signup("Esports")],
        desired: { FLEX_1: "Chess", FLEX_2: "Band" },
      });

      expect(plan.ops.map((o) => o.action)).toEqual(["MOVE", "ADD"]);
      expect(plan.ops[0]).toMatchObject({ fromSessionId: "Esports" });
    });

    it("rearranges all three rotations in one plan", () => {
      const plan = planStudentSchedule({
        sessions,
        currentSignups: [signup("Chess"), signup("Band"), signup("Art")],
        desired: { FLEX_1: "Robotics", FLEX_2: "Choir", FLEX_3: null },
      });

      const byAction = plan.ops.map((o) => o.action);
      expect(byAction.filter((a) => a === "MOVE")).toHaveLength(2);
      expect(byAction.filter((a) => a === "REMOVE")).toHaveLength(1);
      // The emptied rotation is given up, never re-added.
      expect(plan.ops.some((o) => o.toSessionId === "Art")).toBe(false);
    });
  });

  describe("capacity", () => {
    it("reports a session taken past capacity but still plans the op", () => {
      const full = session("Full", ["FLEX_1"], {
        capacity: 2,
        enrolledCount: 2,
      });

      const plan = planStudentSchedule({
        sessions: [...sessions, full],
        currentSignups: [],
        desired: { FLEX_1: "Full" },
      });

      expect(plan.ops).toHaveLength(1);
      expect(plan.ops[0].action).toBe("ADD");
      expect(plan.overCapacity).toEqual([
        {
          clubSessionId: "Full",
          sessionName: "Full",
          capacity: 2,
          newCount: 3,
        },
      ]);
    });

    it("says nothing about a session with room left", () => {
      const plan = planStudentSchedule({
        sessions,
        currentSignups: [],
        desired: { FLEX_1: "Chess" },
      });

      expect(plan.overCapacity).toEqual([]);
    });

    it("reports a session filled to exactly capacity as fine", () => {
      const tight = session("Tight", ["FLEX_1"], {
        capacity: 3,
        enrolledCount: 2,
      });

      const plan = planStudentSchedule({
        sessions: [...sessions, tight],
        currentSignups: [],
        desired: { FLEX_1: "Tight" },
      });

      expect(plan.overCapacity).toEqual([]);
    });

    it("does not report a full session the student is already in", () => {
      // Editing Flex 2 must not warn about the over-full Flex 1 club the
      // student is staying in — that would put a warning on every edit.
      const overfull = session("Overfull", ["FLEX_1"], {
        capacity: 1,
        enrolledCount: 5,
      });

      const plan = planStudentSchedule({
        sessions: [...sessions, overfull],
        currentSignups: [signup("Overfull")],
        desired: { FLEX_2: "Band" },
      });

      expect(plan.overCapacity).toEqual([]);
    });
  });

  describe("required-member signups", () => {
    it("flags a forced signup being given up, without blocking it", () => {
      const plan = planStudentSchedule({
        sessions,
        currentSignups: [signup("Chess", { forced: true })],
        desired: { FLEX_1: "Robotics" },
      });

      expect(plan.ops).toHaveLength(1);
      expect(plan.ops[0]).toMatchObject({
        action: "MOVE",
        droppingForced: true,
      });
    });

    it("flags a forced signup being removed outright", () => {
      const plan = planStudentSchedule({
        sessions,
        currentSignups: [signup("Chess", { forced: true })],
        desired: { FLEX_1: null },
      });

      expect(plan.ops[0]).toMatchObject({
        action: "REMOVE",
        droppingForced: true,
      });
    });

    it("leaves the flag off an ordinary signup", () => {
      const plan = planStudentSchedule({
        sessions,
        currentSignups: [signup("Chess")],
        desired: { FLEX_1: null },
      });

      expect(plan.ops[0].droppingForced).toBeUndefined();
    });
  });
});
