import { describe, it, expect } from "vitest";
import {
  canRecordAttendance,
  isClubManager,
  isTeacherOrAdmin,
} from "./auth-helpers";

/**
 * isClubManager gates every club-scoped mutation in the app, so its edges are
 * worth pinning down.
 */

const club = { ownerId: "owner", cosponsorId: "cosponsor" };

describe("isClubManager", () => {
  it("allows the owner", () => {
    expect(isClubManager(club, "owner", "TEACHER")).toBe(true);
  });

  it("allows the cosponsor", () => {
    expect(isClubManager(club, "cosponsor", "TEACHER")).toBe(true);
  });

  it("allows any admin, even one unconnected to the club", () => {
    expect(isClubManager(club, "someone-else", "ADMIN")).toBe(true);
  });

  it("rejects an unrelated teacher", () => {
    expect(isClubManager(club, "other-teacher", "TEACHER")).toBe(false);
  });

  it("rejects a student who is still listed as the club's owner", () => {
    // Reachable state: demoting a teacher to STUDENT leaves the clubs they own
    // untouched. Several routes gate on this predicate alone, so without the
    // role check a demoted teacher would keep managing their old club.
    expect(isClubManager(club, "owner", "STUDENT")).toBe(false);
  });

  it("rejects a student who is still listed as the cosponsor", () => {
    expect(isClubManager(club, "cosponsor", "STUDENT")).toBe(false);
  });

  it("handles a club with no cosponsor", () => {
    expect(isClubManager({ ownerId: "owner" }, "owner", "TEACHER")).toBe(true);
    expect(isClubManager({ ownerId: "owner" }, "nobody", "TEACHER")).toBe(false);
    expect(
      isClubManager({ ownerId: "owner", cosponsorId: null }, "nobody", "TEACHER")
    ).toBe(false);
  });

  it("still allows an admin who is unrelated to the club", () => {
    // The admin branch precedes the student guard by design: an ADMIN is not a
    // student, and this ordering is what the admin UI relies on.
    expect(isClubManager({ ownerId: "someone" }, "admin-user", "ADMIN")).toBe(
      true
    );
  });
});

describe("isClubManager with no owner", () => {
  it("rejects a teacher unconnected to an ownerless club", () => {
    expect(
      isClubManager({ ownerId: null, cosponsorId: null }, "anyone", "TEACHER")
    ).toBe(false);
  });

  it("still allows the cosponsor of an ownerless club", () => {
    expect(
      isClubManager({ ownerId: null, cosponsorId: "co" }, "co", "TEACHER")
    ).toBe(true);
  });

  it("allows an admin to manage an ownerless club", () => {
    expect(
      isClubManager({ ownerId: null, cosponsorId: null }, "admin", "ADMIN")
    ).toBe(true);
  });

  it("does not treat a null owner as matching a null-ish user id", () => {
    // Guards against `club.ownerId === userId` accidentally passing when both
    // sides are absent.
    expect(
      isClubManager({ ownerId: null }, "" as unknown as string, "TEACHER")
    ).toBe(false);
  });
});

describe("canRecordAttendance", () => {
  const clubSession = {
    club: { ownerId: "owner", cosponsorId: "cosponsor" },
    oneOffOwnerId: null,
  };
  const noCoverage = new Set<string>();

  it("allows a coverage teacher who does not manage the club", () => {
    // The gap this closes: a substitute assigned to cover someone else's club
    // could not record attendance for the session they were standing in.
    expect(
      canRecordAttendance(
        clubSession,
        new Set(["sub1"]),
        "sub1",
        "TEACHER"
      )
    ).toBe(true);
  });

  it("allows the club owner even with no coverage rows", () => {
    expect(
      canRecordAttendance(clubSession, noCoverage, "owner", "TEACHER")
    ).toBe(true);
  });

  it("allows the cosponsor", () => {
    expect(
      canRecordAttendance(clubSession, noCoverage, "cosponsor", "TEACHER")
    ).toBe(true);
  });

  it("allows any admin", () => {
    expect(
      canRecordAttendance(clubSession, noCoverage, "someone", "ADMIN")
    ).toBe(true);
  });

  it("allows the creator of a one-off session", () => {
    expect(
      canRecordAttendance(
        { club: null, oneOffOwnerId: "creator" },
        noCoverage,
        "creator",
        "TEACHER"
      )
    ).toBe(true);
  });

  it("rejects an unrelated teacher", () => {
    expect(
      canRecordAttendance(clubSession, noCoverage, "stranger", "TEACHER")
    ).toBe(false);
  });

  it("rejects a student, even one named in coverage", () => {
    expect(
      canRecordAttendance(clubSession, new Set(["pupil"]), "pupil", "STUDENT")
    ).toBe(false);
  });

  it("allows the assigned teacher of an ownerless club", () => {
    // For a club with no owner, coverage is the only route to attendance.
    expect(
      canRecordAttendance(
        { club: { ownerId: null, cosponsorId: null }, oneOffOwnerId: null },
        new Set(["covering"]),
        "covering",
        "TEACHER"
      )
    ).toBe(true);
  });
});

describe("isTeacherOrAdmin", () => {
  it("accepts teachers and admins, rejects students", () => {
    expect(isTeacherOrAdmin("TEACHER")).toBe(true);
    expect(isTeacherOrAdmin("ADMIN")).toBe(true);
    expect(isTeacherOrAdmin("STUDENT")).toBe(false);
  });
});
