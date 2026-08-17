import { describe, it, expect } from "vitest";
import {
  resolveSessionCoverage,
  resolveSessionTeacherIds,
  type CoverageRow,
} from "./coverage";

/**
 * The reported bug: a club's cosponsor never appeared as T2 on the Coverage page
 * and never received the session's calendar invite. T1 already fell back to the
 * club owner; T2 fell back to nothing.
 */

const club = { ownerId: "owner", cosponsorId: "cosponsor" };
const clubNoCosponsor = { ownerId: "owner", cosponsorId: null };

const row = (
  rotation: CoverageRow["rotation"],
  primary: string | null,
  secondary: string | null
): CoverageRow => ({
  rotation,
  primaryTeacherId: primary,
  secondaryTeacherId: secondary,
});

describe("resolveSessionCoverage", () => {
  it("falls back to the owner as T1 and the cosponsor as T2 when nothing is assigned", () => {
    // The common case: coverage rows are only created when an admin touches the
    // Coverage page, so most sessions have none at all.
    expect(resolveSessionCoverage(club, [], "FLEX_1")).toEqual({
      primaryTeacherId: "owner",
      secondaryTeacherId: "cosponsor",
    });
  });

  it("lets an explicit assignment win over both fallbacks", () => {
    expect(
      resolveSessionCoverage(club, [row("FLEX_1", "sub1", "sub2")], "FLEX_1")
    ).toEqual({ primaryTeacherId: "sub1", secondaryTeacherId: "sub2" });
  });

  it("keeps the cosponsor as T2 when only T1 was reassigned", () => {
    expect(
      resolveSessionCoverage(club, [row("FLEX_1", "sub1", null)], "FLEX_1")
    ).toEqual({ primaryTeacherId: "sub1", secondaryTeacherId: "cosponsor" });
  });

  it("keeps the owner as T1 when only T2 was reassigned", () => {
    expect(
      resolveSessionCoverage(club, [row("FLEX_1", null, "sub2")], "FLEX_1")
    ).toEqual({ primaryTeacherId: "owner", secondaryTeacherId: "sub2" });
  });

  it("leaves T2 empty for a club with no cosponsor", () => {
    expect(resolveSessionCoverage(clubNoCosponsor, [], "FLEX_2")).toEqual({
      primaryTeacherId: "owner",
      secondaryTeacherId: null,
    });
  });

  it("only applies a row to its own rotation", () => {
    const rows = [row("FLEX_1", "sub1", "sub2")];
    expect(resolveSessionCoverage(club, rows, "FLEX_2")).toEqual({
      primaryTeacherId: "owner",
      secondaryTeacherId: "cosponsor",
    });
  });

  it("has no fallback for a one-off session, which has no club", () => {
    expect(resolveSessionCoverage(null, [], "FLEX_1")).toEqual({
      primaryTeacherId: null,
      secondaryTeacherId: null,
    });
    expect(
      resolveSessionCoverage(null, [row("FLEX_1", "teacher", null)], "FLEX_1")
    ).toEqual({ primaryTeacherId: "teacher", secondaryTeacherId: null });
  });
});

describe("resolveSessionTeacherIds", () => {
  it("includes the cosponsor, so they land on the calendar invite", () => {
    const ids = resolveSessionTeacherIds(club, [], ["FLEX_1"]);
    expect([...ids].sort()).toEqual(["cosponsor", "owner"]);
  });

  it("unions across every rotation of a linked session", () => {
    // Different rotations of one linked session can have different cover.
    const rows = [row("FLEX_2", "sub1", "sub2")];
    const ids = resolveSessionTeacherIds(club, rows, [
      "FLEX_1",
      "FLEX_2",
      "FLEX_3",
    ]);
    expect([...ids].sort()).toEqual(["cosponsor", "owner", "sub1", "sub2"]);
  });

  it("does not duplicate a teacher covering several rotations", () => {
    const ids = resolveSessionTeacherIds(club, [], [
      "FLEX_1",
      "FLEX_2",
      "FLEX_3",
    ]);
    expect(ids.size).toBe(2);
  });

  it("is empty for a one-off session with no assigned coverage", () => {
    expect(resolveSessionTeacherIds(null, [], ["FLEX_1"]).size).toBe(0);
  });
});
