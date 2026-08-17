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
  /** Null for a club with no owner — see the note on Club.ownerId in the schema. */
  ownerId: string | null;
  cosponsorId?: string | null;
};

export type CoverageRow = {
  rotation: RotationSlot;
  primaryTeacherId: string | null;
  secondaryTeacherId: string | null;
  /**
   * The admin explicitly decided this rotation needs no second teacher, which
   * suppresses the cosponsor fallback. Optional so callers that genuinely don't
   * care (and older fixtures) don't have to select it; absent behaves as false.
   */
  secondaryCleared?: boolean;
};

/** A teacher who won't attend, for one rotation of one session. */
export type AbsenceRow = {
  teacherId: string;
  rotation: RotationSlot;
};

export type ResolvedCoverage = {
  primaryTeacherId: string | null;
  secondaryTeacherId: string | null;
};

/**
 * Effective T1/T2 for one rotation of one session.
 *
 * `club` is null for one-off sessions — they have no owner or cosponsor to fall
 * back to, so only an explicit assignment counts. A club with no owner behaves
 * the same way for T1.
 *
 * `secondaryCleared` suppresses the cosponsor fallback, which is the only way to
 * express "this rotation needs no second teacher" on a club that has one. It is a
 * stored flag rather than an inference from a null secondary because rows are
 * upserted per field: assigning T1 leaves a null secondary behind that has to keep
 * meaning "not set".
 *
 * Absences are subtracted *after* the fallbacks, which is the whole reason they
 * are stored explicitly: the absent teacher is frequently the club's owner, so
 * removing their coverage row would achieve nothing — the fallback would name
 * them again. An absent teacher resolves to null, which the admin Coverage page
 * already surfaces as needing cover.
 */
export function resolveSessionCoverage(
  club: CoverageClubRef | null | undefined,
  rows: CoverageRow[],
  rotation: RotationSlot,
  absences: AbsenceRow[] = []
): ResolvedCoverage {
  const row = rows.find((r) => r.rotation === rotation);
  const absent = new Set(
    absences.filter((a) => a.rotation === rotation).map((a) => a.teacherId)
  );

  const primary = row?.primaryTeacherId ?? club?.ownerId ?? null;
  const secondaryDefault = row?.secondaryCleared
    ? null
    : (club?.cosponsorId ?? null);
  const secondary = row?.secondaryTeacherId ?? secondaryDefault;

  return {
    primaryTeacherId: primary && !absent.has(primary) ? primary : null,
    secondaryTeacherId: secondary && !absent.has(secondary) ? secondary : null,
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
  rotations: RotationSlot[],
  absences: AbsenceRow[] = []
): Set<string> {
  const ids = new Set<string>();
  for (const rotation of rotations) {
    const { primaryTeacherId, secondaryTeacherId } = resolveSessionCoverage(
      club,
      rows,
      rotation,
      absences
    );
    if (primaryTeacherId) ids.add(primaryTeacherId);
    if (secondaryTeacherId) ids.add(secondaryTeacherId);
  }
  return ids;
}

/**
 * Rotations of this session where `teacherId` is expected to be present.
 *
 * Used by the teacher dashboard to detect double-booking: a teacher expected in
 * the same rotation by two different sessions cannot attend both.
 */
export function rotationsExpectingTeacher(
  club: CoverageClubRef | null | undefined,
  rows: CoverageRow[],
  rotations: RotationSlot[],
  absences: AbsenceRow[],
  teacherId: string
): RotationSlot[] {
  return rotations.filter((rotation) => {
    const { primaryTeacherId, secondaryTeacherId } = resolveSessionCoverage(
      club,
      rows,
      rotation,
      absences
    );
    return primaryTeacherId === teacherId || secondaryTeacherId === teacherId;
  });
}
