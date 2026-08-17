import { describe, it, expect } from "vitest";
import {
  resolveSessionCoverage,
  resolveSessionTeacherIds,
  rotationsExpectingTeacher,
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

  it("excludes an absent teacher, so they aren't invited", () => {
    const ids = resolveSessionTeacherIds(club, [], ["FLEX_1"], [
      { teacherId: "owner", rotation: "FLEX_1" },
    ]);
    expect([...ids]).toEqual(["cosponsor"]);
  });
});

describe("resolveSessionCoverage with absences", () => {
  it("clears an absent owner from T1 even though they are the default", () => {
    // This is the reason absences are stored rather than derived: deleting a
    // coverage row wouldn't remove the owner, the fallback would re-add them.
    expect(
      resolveSessionCoverage(club, [], "FLEX_1", [
        { teacherId: "owner", rotation: "FLEX_1" },
      ])
    ).toEqual({ primaryTeacherId: null, secondaryTeacherId: "cosponsor" });
  });

  it("clears an absent cosponsor from T2", () => {
    expect(
      resolveSessionCoverage(club, [], "FLEX_1", [
        { teacherId: "cosponsor", rotation: "FLEX_1" },
      ])
    ).toEqual({ primaryTeacherId: "owner", secondaryTeacherId: null });
  });

  it("clears an explicitly assigned teacher who is marked absent", () => {
    // An explicit assignment does not override an absence — the person still
    // isn't in the room.
    expect(
      resolveSessionCoverage(
        club,
        [row("FLEX_1", "sub1", null)],
        "FLEX_1",
        [{ teacherId: "sub1", rotation: "FLEX_1" }]
      )
    ).toEqual({ primaryTeacherId: null, secondaryTeacherId: "cosponsor" });
  });

  it("only applies an absence to the rotation it names", () => {
    const absences = [{ teacherId: "owner", rotation: "FLEX_1" as const }];
    expect(
      resolveSessionCoverage(club, [], "FLEX_1", absences).primaryTeacherId
    ).toBeNull();
    expect(
      resolveSessionCoverage(club, [], "FLEX_2", absences).primaryTeacherId
    ).toBe("owner");
  });

  it("resolves T1 to null for a club with no owner", () => {
    expect(
      resolveSessionCoverage({ ownerId: null, cosponsorId: null }, [], "FLEX_1")
    ).toEqual({ primaryTeacherId: null, secondaryTeacherId: null });
  });

  it("still honors an explicit assignment on a club with no owner", () => {
    expect(
      resolveSessionCoverage(
        { ownerId: null, cosponsorId: null },
        [row("FLEX_1", "rotating", null)],
        "FLEX_1"
      ).primaryTeacherId
    ).toBe("rotating");
  });
});

describe("rotationsExpectingTeacher", () => {
  it("lists the rotations where a teacher is the resolved default", () => {
    expect(
      rotationsExpectingTeacher(club, [], ["FLEX_1", "FLEX_2"], [], "owner")
    ).toEqual(["FLEX_1", "FLEX_2"]);
  });

  it("omits rotations the teacher is absent from", () => {
    expect(
      rotationsExpectingTeacher(
        club,
        [],
        ["FLEX_1", "FLEX_2"],
        [{ teacherId: "owner", rotation: "FLEX_1" }],
        "owner"
      )
    ).toEqual(["FLEX_2"]);
  });

  it("includes a teacher assigned explicitly but unrelated to the club", () => {
    // The case that previously left a substitute unable to see their own session.
    expect(
      rotationsExpectingTeacher(
        club,
        [row("FLEX_2", "sub1", null)],
        ["FLEX_1", "FLEX_2"],
        [],
        "sub1"
      )
    ).toEqual(["FLEX_2"]);
  });

  it("is empty for a teacher with no connection to the session", () => {
    expect(
      rotationsExpectingTeacher(club, [], ["FLEX_1"], [], "stranger")
    ).toEqual([]);
  });
});
