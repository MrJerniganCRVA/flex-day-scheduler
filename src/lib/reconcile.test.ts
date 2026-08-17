import { describe, it, expect } from "vitest";
import type { RotationSlot } from "@prisma/client";
import { planReconcile, desiredSessionShapes } from "./reconcile";

/**
 * Editing a club's rotations used to change the Club row and nothing else, so a
 * club whose sessions already existed stayed frozen in its original shape. These
 * cover the rules for reshaping future sessions — in particular that nothing
 * carrying a student's signup is ever deleted to make a club's shape tidy.
 */

const DAY = new Date("2026-09-02T00:00:00.000Z");

function session(
  id: string,
  rotations: RotationSlot[],
  opts: { signups?: number; eventId?: string | null } = {}
) {
  return {
    id,
    rotations,
    googleEventId: opts.eventId ?? null,
    _count: { signups: opts.signups ?? 0 },
  };
}

const plan = (
  existing: ReturnType<typeof session>[],
  desired: RotationSlot[][],
  finalized = false
) =>
  planReconcile({
    existing,
    desired,
    flexDayFinalized: finalized,
    flexDayDate: DAY,
  });

describe("desiredSessionShapes", () => {
  it("gives one multi-rotation session when linked", () => {
    expect(
      desiredSessionShapes({
        defaultRotations: ["FLEX_2", "FLEX_1"],
        linkedRotations: true,
      })
    ).toEqual([["FLEX_1", "FLEX_2"]]);
  });

  it("gives one session per rotation when unlinked", () => {
    expect(
      desiredSessionShapes({
        defaultRotations: ["FLEX_2", "FLEX_1"],
        linkedRotations: false,
      })
    ).toEqual([["FLEX_1"], ["FLEX_2"]]);
  });

  it("gives nothing for a club with no default rotations", () => {
    expect(
      desiredSessionShapes({ defaultRotations: [], linkedRotations: true })
    ).toEqual([]);
  });
});

describe("planReconcile", () => {
  it("creates sessions for a newly added rotation", () => {
    const result = plan([session("a", ["FLEX_1"])], [["FLEX_1"], ["FLEX_2"]]);
    expect(result.toCreate).toEqual([["FLEX_2"]]);
    expect(result.toDelete).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it("deletes an empty session for a dropped rotation", () => {
    const result = plan(
      [session("a", ["FLEX_1"]), session("b", ["FLEX_2"])],
      [["FLEX_1"]]
    );
    expect(result.toCreate).toEqual([]);
    expect(result.toDelete).toEqual(["b"]);
    expect(result.skipped).toEqual([]);
  });

  it("refuses to delete a session students have signed up for", () => {
    const result = plan(
      [session("a", ["FLEX_1"]), session("b", ["FLEX_2"], { signups: 3 })],
      [["FLEX_1"]]
    );
    expect(result.toDelete).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatchObject({
      sessionId: "b",
      reason: "has-signups",
    });
  });

  it("refuses to delete anything on a finalized flex day", () => {
    // Invites are already on students' calendars.
    const result = plan([session("b", ["FLEX_2"])], [["FLEX_1"]], true);
    expect(result.toDelete).toEqual([]);
    expect(result.skipped[0]).toMatchObject({ reason: "flex-day-finalized" });
    // A missing session is still created — adding never destroys anything.
    expect(result.toCreate).toEqual([["FLEX_1"]]);
  });

  it("refuses to delete a session that already has a calendar event", () => {
    const result = plan(
      [session("b", ["FLEX_2"], { eventId: "evt_1" })],
      [["FLEX_1"]]
    );
    expect(result.toDelete).toEqual([]);
    expect(result.skipped[0]).toMatchObject({ reason: "has-calendar-event" });
  });

  it("reports signups ahead of finalization when both apply", () => {
    // Both are true; the signup is the more useful thing to tell an admin.
    const result = plan(
      [session("b", ["FLEX_2"], { signups: 1 })],
      [["FLEX_1"]],
      true
    );
    expect(result.skipped[0].reason).toBe("has-signups");
  });

  it("treats a linked session as matching regardless of rotation order", () => {
    const result = plan(
      [session("a", ["FLEX_3", "FLEX_1", "FLEX_2"])],
      [["FLEX_1", "FLEX_2", "FLEX_3"]]
    );
    expect(result.toCreate).toEqual([]);
    expect(result.toDelete).toEqual([]);
  });

  it("handles a linked-to-unlinked switch on an empty day", () => {
    const result = plan(
      [session("linked", ["FLEX_1", "FLEX_2"])],
      [["FLEX_1"], ["FLEX_2"]]
    );
    expect(result.toDelete).toEqual(["linked"]);
    expect(result.toCreate).toEqual([["FLEX_1"], ["FLEX_2"]]);
  });

  it("leaves a linked-to-unlinked switch alone when students are booked", () => {
    // Splitting a session with signups is what the per-session Split control is
    // for — it migrates signups and calendar events properly.
    const result = plan(
      [session("linked", ["FLEX_1", "FLEX_2"], { signups: 5 })],
      [["FLEX_1"], ["FLEX_2"]]
    );
    expect(result.toDelete).toEqual([]);
    expect(result.skipped[0]).toMatchObject({ reason: "has-signups" });
    // The desired shapes are still created, so the club runs where it should.
    expect(result.toCreate).toEqual([["FLEX_1"], ["FLEX_2"]]);
  });

  it("is idempotent — a second pass over its own output changes nothing", () => {
    const desired: RotationSlot[][] = [["FLEX_1"], ["FLEX_2"]];
    const first = plan([session("a", ["FLEX_1"])], desired);
    expect(first.toCreate).toEqual([["FLEX_2"]]);

    const after = [session("a", ["FLEX_1"]), session("new", ["FLEX_2"])];
    const second = plan(after, desired);
    expect(second.toCreate).toEqual([]);
    expect(second.toDelete).toEqual([]);
    expect(second.skipped).toEqual([]);
  });

  it("pairs duplicates one-to-one rather than deleting both", () => {
    // Two sessions with the same rotation and one desired shape: keep one.
    const result = plan(
      [session("a", ["FLEX_1"]), session("dupe", ["FLEX_1"])],
      [["FLEX_1"]]
    );
    expect(result.toCreate).toEqual([]);
    expect(result.toDelete).toEqual(["dupe"]);
  });

  it("removes everything empty when a club has no rotations left", () => {
    const result = plan([session("a", ["FLEX_1"])], []);
    expect(result.toDelete).toEqual(["a"]);
    expect(result.toCreate).toEqual([]);
  });
});
