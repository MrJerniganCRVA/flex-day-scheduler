import type { RotationSlot } from "@prisma/client";

/**
 * Resolving who is teaching a session, in one place.
 *
 * A session's coverage is stored in SessionRotationCoverage, but those rows are
 * created lazily — only when an admin actually touches the Coverage page. So for
 * most sessions there is no row at all, and the teachers have to be *derived*:
 *
 *   T1 = explicit primary   ?? the club's owner
 *   T2 = explicit secondary ?? the club's cosponsor
 *
 * The T1 fallback already existed (inline in CoverageDashboard). The T2 fallback
 * did not, which is why a cosponsor never appeared on the Coverage page and —
 * worse — never received the calendar invite for a club they co-run.
 *
 * This lives in one module because three call sites need the same answer: the
 * Coverage page, the CoverageDashboard client component, and finalize's attendee
 * list. Duplicating the `??` chain is exactly how the roster an admin *sees*
 * drifts from the roster that actually gets *invited*.
 *
 * Deliberately a derivation, not stored data. Writing `secondaryTeacherId =
 * cosponsorId` into the coverage rows would go stale the moment a club's
 * cosponsor changed — which is the bug this fixes, reintroduced.
 */

export type CoverageClubRef = {
  ownerId: string;
  cosponsorId?: string | null;
};

export type CoverageRow = {
  rotation: RotationSlot;
  primaryTeacherId: string | null;
  secondaryTeacherId: string | null;
};

export type ResolvedCoverage = {
  primaryTeacherId: string | null;
  secondaryTeacherId: string | null;
};

/**
 * Effective T1/T2 for one rotation of one session.
 *
 * `club` is null for one-off sessions — they have no owner or cosponsor to fall
 * back to, so only an explicit assignment counts.
 */
export function resolveSessionCoverage(
  club: CoverageClubRef | null | undefined,
  rows: CoverageRow[],
  rotation: RotationSlot
): ResolvedCoverage {
  const row = rows.find((r) => r.rotation === rotation);
  return {
    primaryTeacherId: row?.primaryTeacherId ?? club?.ownerId ?? null,
    secondaryTeacherId: row?.secondaryTeacherId ?? club?.cosponsorId ?? null,
  };
}

/**
 * Every distinct teacher expected in the room across all of a session's
 * rotations — the set that should be on the calendar event.
 *
 * A linked session spanning three rotations may have different coverage per
 * rotation, so this unions across all of them.
 */
export function resolveSessionTeacherIds(
  club: CoverageClubRef | null | undefined,
  rows: CoverageRow[],
  rotations: RotationSlot[]
): Set<string> {
  const ids = new Set<string>();
  for (const rotation of rotations) {
    const { primaryTeacherId, secondaryTeacherId } = resolveSessionCoverage(
      club,
      rows,
      rotation
    );
    if (primaryTeacherId) ids.add(primaryTeacherId);
    if (secondaryTeacherId) ids.add(secondaryTeacherId);
  }
  return ids;
}
