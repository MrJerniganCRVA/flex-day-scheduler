import { describe, it, expect } from "vitest";
import {
  type BlockOutcome,
  describeProblems,
  googleErrorReason,
  isMissingEvent,
} from "./calendar-outcome";

/**
 * What an admin is told after pressing a send button.
 *
 * This is the only thing that has ever reported a block getting no invite — the
 * button used to simply go green while a whole day of failures sat in the server
 * log. The ordering matters as much as the wording: a block that sent from the
 * wrong calendar is an FYI and must not push a block that sent nothing at all
 * out of an admin's eyeline.
 */

const sent = (label: string, teacherName?: string | null): BlockOutcome => ({
  rotation: "FLEX_1",
  label,
  kind: "sent",
  fellBackFrom: teacherName === undefined ? null : { teacherName },
});

describe("describeProblems", () => {
  it("says nothing about blocks that went out cleanly", () => {
    expect(describeProblems([sent("Art Club — Flex 1")])).toEqual([]);
  });

  it("distinguishes an unstaffed duty post from one whose teacher cannot send", () => {
    const [unstaffed, noCalendar] = describeProblems([
      {
        rotation: "FLEX_2",
        label: "Cafeteria duty — Flex 2",
        kind: "skipped",
        teacherName: null,
        reason: "unstaffed",
      },
      {
        rotation: "FLEX_2",
        label: "Front doors duty — Flex 2",
        kind: "skipped",
        teacherName: "Dana Reyes",
        reason: "no-calendar",
      },
    ]);

    // An unstaffed post is a rota gap: nothing about Google is wrong, and saying
    // so would send an admin chasing a connection problem that does not exist.
    expect(unstaffed).toBe(
      "Cafeteria duty — Flex 2: nobody is assigned to cover this block, so no invite was sent."
    );
    expect(unstaffed).not.toMatch(/Google/);

    expect(noCalendar).toContain("Dana Reyes");
    expect(noCalendar).toMatch(/has not connected their Google Calendar/);
  });

  it("reports a fallback send, after the blocks that sent nothing", () => {
    const problems = describeProblems([
      sent("Art Club — Flex 1", "Sam Okafor"),
      {
        rotation: "FLEX_1",
        label: "Chess Club — Flex 1",
        kind: "failed",
        error: { errors: [{ message: "Invalid attendee." }] },
      },
      {
        rotation: "FLEX_3",
        label: "Library duty — Flex 3",
        kind: "skipped",
        teacherName: null,
        reason: "unstaffed",
      },
    ]);

    // Failures, then skips, then the merely-noteworthy.
    expect(problems).toHaveLength(3);
    expect(problems[0]).toContain("Chess Club — Flex 1");
    expect(problems[0]).toContain("Invalid attendee");
    expect(problems[1]).toContain("Library duty — Flex 3");
    expect(problems[2]).toContain(
      "Sam Okafor has not connected their Google Calendar, so the invite was sent from an admin instead."
    );
  });

  it("still names the block when Google gives no reason at all", () => {
    expect(
      describeProblems([
        { rotation: "FLEX_1", label: "Art Club — Flex 1", kind: "failed", error: null },
      ])
    ).toEqual(["Art Club — Flex 1: Google Calendar rejected the request."]);
  });
});

describe("googleErrorReason", () => {
  it("digs the reason out of each shape googleapis throws", () => {
    expect(googleErrorReason({ errors: [{ message: "Bad Request." }] })).toBe(
      "Bad Request"
    );
    expect(
      googleErrorReason({ response: { data: { error: { message: "Forbidden" } } } })
    ).toBe("Forbidden");
    expect(googleErrorReason({ message: "Network down." })).toBe("Network down");
    expect(googleErrorReason("not an object")).toBeNull();
  });
});

describe("isMissingEvent", () => {
  it("treats 404 and 410 as gone, whichever field carries the status", () => {
    expect(isMissingEvent({ code: 404 })).toBe(true);
    expect(isMissingEvent({ status: 410 })).toBe(true);
    expect(isMissingEvent({ response: { status: 404 } })).toBe(true);
  });

  it("leaves every other failure to be raised", () => {
    expect(isMissingEvent({ code: 403 })).toBe(false);
    expect(isMissingEvent({ code: 500 })).toBe(false);
    expect(isMissingEvent(null)).toBe(false);
  });
});
