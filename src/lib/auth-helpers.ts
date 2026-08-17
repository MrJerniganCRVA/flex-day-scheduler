import { Role } from "@prisma/client";

/**
 * Pure authorization predicates. Deliberately free of any dependency on the
 * Auth.js session module: every route resolves its own session and then asks
 * these functions a question about it, which keeps them directly unit-testable.
 *
 * This module previously also exported `requireAuth` / `requireRole` helpers
 * that fetched the session and threw Response objects. No route ever used them
 * — all 23 hand-roll the check inline — and importing `@/auth` for their sake
 * dragged the whole Next.js server runtime in behind them.
 */

export function isTeacherOrAdmin(role: Role): boolean {
  return role === "TEACHER" || role === "ADMIN";
}

/**
 * Whether a user can manage a club: admins always can, otherwise the club's
 * owner or its cosponsor (both have full co-owner permissions).
 *
 * Students never can, even when their id still appears as the club's ownerId or
 * cosponsorId. That combination is reachable: demoting a teacher to STUDENT
 * doesn't clear the clubs they own, and several routes gate on this predicate
 * alone with no separate role check — so without this guard a demoted teacher
 * would keep creating sessions and recording attendance for their old club.
 * (Deleting such a user is already blocked until ownership is reassigned; a
 * demotion had no equivalent protection.)
 */
export function isClubManager(
  club: { ownerId: string | null; cosponsorId?: string | null },
  userId: string,
  role: Role
): boolean {
  if (role === "ADMIN") return true;
  if (role === "STUDENT") return false;
  if (club.ownerId !== null && club.ownerId === userId) return true;
  return club.cosponsorId === userId;
}

/**
 * Whether a user may record attendance for a session.
 *
 * Broader than `isClubManager` on purpose: whoever is actually standing in the
 * room takes the register. A substitute assigned to cover a club they don't own
 * previously could not record attendance for the session they were covering —
 * and for a club with no owner at all, the assigned coverage teacher is the only
 * person who can.
 *
 * `coverageTeacherIds` should come from `resolveSessionTeacherIds` in
 * src/lib/coverage.ts, so implicit owner/cosponsor defaults and absences are
 * already accounted for.
 */
export function canRecordAttendance(
  session: {
    club: { ownerId: string | null; cosponsorId?: string | null } | null;
    oneOffOwnerId?: string | null;
  },
  coverageTeacherIds: Set<string>,
  userId: string,
  role: Role
): boolean {
  if (role === "ADMIN") return true;
  if (role === "STUDENT") return false;
  if (session.oneOffOwnerId === userId) return true;
  if (coverageTeacherIds.has(userId)) return true;
  return session.club ? isClubManager(session.club, userId, role) : false;
}
