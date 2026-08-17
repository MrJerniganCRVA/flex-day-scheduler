import { describe, it, expect } from "vitest";
import { isClubManager, isTeacherOrAdmin } from "./auth-helpers";

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

describe("isTeacherOrAdmin", () => {
  it("accepts teachers and admins, rejects students", () => {
    expect(isTeacherOrAdmin("TEACHER")).toBe(true);
    expect(isTeacherOrAdmin("ADMIN")).toBe(true);
    expect(isTeacherOrAdmin("STUDENT")).toBe(false);
  });
});
