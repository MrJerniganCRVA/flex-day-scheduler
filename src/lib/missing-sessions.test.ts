import { describe, it, expect } from "vitest";
import type { RotationSlot } from "@prisma/client";
import { findMissingFlexDays } from "./missing-sessions";

/**
 * A teacher who removed a club's session from a Flex Day had no way to put it
 * back. These cover which days the "add it back" panel offers.
 */

const DAY = new Date("2026-11-04T00:00:00.000Z");

function day(
  id: string,
  sessions: RotationSlot[][],
  isFinalized = false
) {
  return {
    id,
    date: DAY,
    label: null,
    isFinalized,
    sessions: sessions.map((rotations) => ({ rotations })),
  };
}

const ALL: RotationSlot[] = ["FLEX_1", "FLEX_2", "FLEX_3"];

describe("findMissingFlexDays", () => {
  it("offers a day whose session was removed entirely", () => {
    const result = findMissingFlexDays({
      defaultRotations: ALL,
      flexDays: [day("a", [])],
    });
    expect(result).toEqual([
      { id: "a", date: DAY, label: null, missingRotations: ALL },
    ]);
  });

  it("offers only the rotation removed from an unlinked club", () => {
    const result = findMissingFlexDays({
      defaultRotations: ALL,
      flexDays: [day("a", [["FLEX_1"], ["FLEX_3"]])],
    });
    expect(result.map((d) => d.missingRotations)).toEqual([["FLEX_2"]]);
  });

  it("skips a day that is fully covered, however the sessions are split", () => {
    const result = findMissingFlexDays({
      defaultRotations: ALL,
      flexDays: [day("linked", [ALL]), day("split", [["FLEX_1", "FLEX_2"], ["FLEX_3"]])],
    });
    expect(result).toEqual([]);
  });

  it("skips a finalized day even when sessions are missing", () => {
    const result = findMissingFlexDays({
      defaultRotations: ALL,
      flexDays: [day("a", [], true)],
    });
    expect(result).toEqual([]);
  });

  it("ignores rotations outside the club's defaults", () => {
    const result = findMissingFlexDays({
      defaultRotations: ["FLEX_1"],
      flexDays: [day("a", [["FLEX_1"]])],
    });
    expect(result).toEqual([]);
  });
});
