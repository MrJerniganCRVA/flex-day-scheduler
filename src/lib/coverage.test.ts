import { describe, it, expect } from "vitest";
import {
  resolveSessionCoverage,
  resolveSessionTeacherIds,
  rotationsExpectingTeacher,
  sessionRef,
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
  secondary: string | null,
  secondaryCleared = false
): CoverageRow => ({
  rotation,
  primaryTeacherId: primary,
  secondaryTeacherId: secondary,
  secondaryCleared,
});

describe("resolveSessionCoverage", () => {
  it("falls back to the owner as T1 and the cosponsor as T2 when nothing is assigned", () => {
    // The common case: coverage rows are only created when an admin touches the
    // Coverage page, so most sessions have none at all.
    expect(resolveSessionCoverage(club, [], "FLEX_1", [])).toEqual({
      primaryTeacherId: "owner",
      secondaryTeacherId: "cosponsor",
    });
  });

  it("lets an explicit assignment win over both fallbacks", () => {
    expect(
      resolveSessionCoverage(club, [row("FLEX_1", "sub1", "sub2")], "FLEX_1", [])
    ).toEqual({ primaryTeacherId: "sub1", secondaryTeacherId: "sub2" });
  });

  it("keeps the cosponsor as T2 when only T1 was reassigned", () => {
    expect(
      resolveSessionCoverage(club, [row("FLEX_1", "sub1", null)], "FLEX_1", [])
    ).toEqual({ primaryTeacherId: "sub1", secondaryTeacherId: "cosponsor" });
  });

  it("keeps the owner as T1 when only T2 was reassigned", () => {
    expect(
      resolveSessionCoverage(club, [row("FLEX_1", null, "sub2")], "FLEX_1", [])
    ).toEqual({ primaryTeacherId: "owner", secondaryTeacherId: "sub2" });
  });

  it("leaves T2 empty for a club with no cosponsor", () => {
    expect(resolveSessionCoverage(clubNoCosponsor, [], "FLEX_2", [])).toEqual({
      primaryTeacherId: "owner",
      secondaryTeacherId: null,
    });
  });

  it("only applies a row to its own rotation", () => {
    const rows = [row("FLEX_1", "sub1", "sub2")];
    expect(resolveSessionCoverage(club, rows, "FLEX_2", [])).toEqual({
      primaryTeacherId: "owner",
      secondaryTeacherId: "cosponsor",
    });
  });

  it("has no fallback for a one-off session, which has no club", () => {
    expect(resolveSessionCoverage(null, [], "FLEX_1", [])).toEqual({
      primaryTeacherId: null,
      secondaryTeacherId: null,
    });
    expect(
      resolveSessionCoverage(null, [row("FLEX_1", "teacher", null)], "FLEX_1", [])
    ).toEqual({ primaryTeacherId: "teacher", secondaryTeacherId: null });
  });
});

describe("resolveSessionTeacherIds", () => {
  it("includes the cosponsor, so they land on the calendar invite", () => {
    const ids = resolveSessionTeacherIds(club, [], ["FLEX_1"], []);
    expect([...ids].sort()).toEqual(["cosponsor", "owner"]);
  });

  it("unions across every rotation of a linked session", () => {
    // Different rotations of one linked session can have different cover.
    const rows = [row("FLEX_2", "sub1", "sub2")];
    const ids = resolveSessionTeacherIds(club, rows, [
      "FLEX_1",
      "FLEX_2",
      "FLEX_3",
    ], []);
    expect([...ids].sort()).toEqual(["cosponsor", "owner", "sub1", "sub2"]);
  });

  it("does not duplicate a teacher covering several rotations", () => {
    const ids = resolveSessionTeacherIds(club, [], [
      "FLEX_1",
      "FLEX_2",
      "FLEX_3",
    ], []);
    expect(ids.size).toBe(2);
  });

  it("is empty for a one-off session with no assigned coverage", () => {
    expect(resolveSessionTeacherIds(null, [], ["FLEX_1"], []).size).toBe(0);
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
      resolveSessionCoverage({ ownerId: null, cosponsorId: null }, [], "FLEX_1", [])
    ).toEqual({ primaryTeacherId: null, secondaryTeacherId: null });
  });

  it("still honors an explicit assignment on a club with no owner", () => {
    expect(
      resolveSessionCoverage(
        { ownerId: null, cosponsorId: null },
        [row("FLEX_1", "rotating", null)],
        "FLEX_1", []
      ).primaryTeacherId
    ).toBe("rotating");
  });
});

describe("resolveSessionCoverage with a cleared T2", () => {
  it("resolves T2 to null even though the club has a cosponsor", () => {
    // The case that had no representation at all: an admin saying this rotation
    // needs no second teacher. Writing a null secondary alone was not enough —
    // the cosponsor fallback simply re-derived them.
    expect(
      resolveSessionCoverage(club, [row("FLEX_1", null, null, true)], "FLEX_1", [])
    ).toEqual({ primaryTeacherId: "owner", secondaryTeacherId: null });
  });

  it("keeps the cosponsor fallback when the flag is false", () => {
    // No regression: a null secondary without the flag still means "not set".
    expect(
      resolveSessionCoverage(club, [row("FLEX_1", null, null, false)], "FLEX_1", [])
        .secondaryTeacherId
    ).toBe("cosponsor");
  });

  it("still resolves to the cosponsor for a row created by setting T1 only", () => {
    // This is precisely why the flag exists rather than inferring from the null:
    // rows are upserted per field, so assigning T1 leaves a null secondary behind
    // that must keep meaning "not set".
    expect(
      resolveSessionCoverage(club, [row("FLEX_1", "sub1", null)], "FLEX_1", [])
    ).toEqual({ primaryTeacherId: "sub1", secondaryTeacherId: "cosponsor" });
  });

  it("lets an explicit teacher win over the cleared flag", () => {
    // Shouldn't co-occur, but if both are set the named teacher is the more
    // specific intent.
    expect(
      resolveSessionCoverage(club, [row("FLEX_1", null, "sub2", true)], "FLEX_1", [])
        .secondaryTeacherId
    ).toBe("sub2");
  });

  it("only clears the rotation whose row carries the flag", () => {
    const rows = [row("FLEX_1", null, null, true)];
    expect(
      resolveSessionCoverage(club, rows, "FLEX_1", []).secondaryTeacherId
    ).toBeNull();
    expect(
      resolveSessionCoverage(club, rows, "FLEX_2", []).secondaryTeacherId
    ).toBe("cosponsor");
  });

  it("keeps a cleared cosponsor off the calendar invite", () => {
    const ids = resolveSessionTeacherIds(
      club,
      [row("FLEX_1", null, null, true)],
      ["FLEX_1"], []
    );
    expect([...ids]).toEqual(["owner"]);
  });

  it("treats an absent row's flag as false when omitted", () => {
    // CoverageRow.secondaryCleared is optional for callers that don't select it.
    expect(
      resolveSessionCoverage(club, [], "FLEX_1", []).secondaryTeacherId
    ).toBe("cosponsor");
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

describe("one-off sessions", () => {
  // A one-off has no club, so before this its creator was never anybody's
  // resolved teacher: the session was filtered off the Coverage page entirely,
  // and a teacher running one opposite their own club got no clash warning.
  const oneOff = sessionRef({ club: null, oneOffOwnerId: "creator" });

  it("treats the creator as the implicit primary teacher", () => {
    expect(resolveSessionCoverage(oneOff, [], "FLEX_1", [])).toEqual({
      primaryTeacherId: "creator",
      secondaryTeacherId: null,
    });
  });

  it("counts the creator for double-booking detection", () => {
    expect(
      rotationsExpectingTeacher(oneOff, [], ["FLEX_2"], [], "creator")
    ).toEqual(["FLEX_2"]);
  });

  it("drops the creator when they mark themselves absent", () => {
    expect(
      resolveSessionCoverage(oneOff, [], "FLEX_1", [
        { teacherId: "creator", rotation: "FLEX_1" },
      ]).primaryTeacherId
    ).toBeNull();
  });

  it("lets an assigned substitute override the creator", () => {
    expect(
      resolveSessionCoverage(oneOff, [row("FLEX_1", "sub1", null)], "FLEX_1", [])
        .primaryTeacherId
    ).toBe("sub1");
  });

  it("puts the creator on the calendar invite", () => {
    expect([...resolveSessionTeacherIds(oneOff, [], ["FLEX_1"], [])]).toEqual([
      "creator",
    ]);
  });
});

describe("sessionRef", () => {
  it("prefers a club owner over a one-off owner", () => {
    // Both are never set at once, but the club is the more specific source.
    const ref = sessionRef({
      club: { ownerId: "owner", cosponsorId: "cosponsor" },
      oneOffOwnerId: "creator",
    });
    expect(resolveSessionCoverage(ref, [], "FLEX_1", [])).toEqual({
      primaryTeacherId: "owner",
      secondaryTeacherId: "cosponsor",
    });
  });

  it("yields no defaults for a club with no owner and no one-off owner", () => {
    const ref = sessionRef({ club: { ownerId: null }, oneOffOwnerId: null });
    expect(resolveSessionCoverage(ref, [], "FLEX_1", [])).toEqual({
      primaryTeacherId: null,
      secondaryTeacherId: null,
    });
  });

  it("falls through to the one-off owner when the club is absent", () => {
    const ref = sessionRef({ oneOffOwnerId: "creator" });
    expect(resolveSessionCoverage(ref, [], "FLEX_3", []).primaryTeacherId).toBe(
      "creator"
    );
  });
});
