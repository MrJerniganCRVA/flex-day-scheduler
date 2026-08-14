import { auth } from "@/auth";
import { Role } from "@prisma/client";

/**
 * Get the current session on the server side.
 * Throws a 401 Response if the user is not authenticated.
 */
export async function requireAuth() {
  const session = await auth();
  if (!session?.user) {
    throw new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return session;
}

/**
 * Get the current session and verify the user has one of the required roles.
 * Throws a 403 Response if the role check fails.
 */
export async function requireRole(...roles: Role[]) {
  const session = await requireAuth();
  if (!roles.includes(session.user.role)) {
    throw new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  return session;
}

export function isTeacherOrAdmin(role: Role): boolean {
  return role === "TEACHER" || role === "ADMIN";
}

/**
 * Whether a user can manage a club: admins always can, otherwise the club's
 * owner or any of its cosponsors (both have full co-owner permissions).
 */
export function isClubManager(
  club: { ownerId: string; cosponsors?: { id: string }[] },
  userId: string,
  role: Role
): boolean {
  if (role === "ADMIN") return true;
  if (club.ownerId === userId) return true;
  return club.cosponsors?.some((c) => c.id === userId) ?? false;
}
