import type { RotationSlot } from "@prisma/client";

/**
 * Resolving who is teaching a session, in one place.
 *
 * A session's coverage is stored in SessionRotationCoverage, but those rows are
 * created lazily — only when an admin actually touches the Coverage page. So for
 * most sessions there is no row at all, and the teachers have to be *derived*:
 *
 *   T1 = explicit primary   ?? the club's owner  ?? the one-off's creator
 *   T2 = explicit secondary ?? the club's cosponsor
 *
 * Then absences are subtracted. `primaryCleared` / `secondaryCleared` suppress the
 * corresponding fallback, which is the only way to say "this slot is deliberately
 * empty" — a null id alone cannot, because rows are upserted per field.
 *
 * **Every surface must go through this module.** That is not a style preference:
 * the Coverage page used to re-derive T1/T2 inline, and when absences were added
 * here it silently kept showing teachers who had stepped back — on the very screen
 * an admin uses to find sessions needing cover. Two implementations means one of
 * them is quietly wrong.
 *
 * Two deliberate choices guard that:
 *
 *  - the `*Cleared` flags and `absences` are **required**, not optional. Both were
 *    optional once, and that is exactly what let a query forget a column and still
 *    typecheck while producing a different answer from the rest of the app. A
 *    caller with genuinely no absences passes `[]`, which reads as a decision.
 *  - The Prisma `select` fragments below are exported so no screen hand-rolls its
 *    own. Adding a column here reaches every reader at once.
 *
 * Deliberately a derivation, not stored data. Writing `secondaryTeacherId =
 * cosponsorId` into the coverage rows would go stale the moment a club's
 * cosponsor changed — which is the bug this fixes, reintroduced.
 */

/**
 * Everything about a session that feeds the defaults. Clubs contribute an owner
 * and cosponsor; one-off sessions contribute their creator, who is the teacher
 * standing in that room just as surely as a club's owner is.
 */
export type CoverageSessionRef = {
  /** Null for a club with no owner — see the note on Club.ownerId in the schema. */
  ownerId: string | null;
  cosponsorId?: string | null;
  /** Set only for one-off sessions, which have no club. */
  oneOffOwnerId?: string | null;
};

/**
 * Build a session ref from a row shaped like `{ club, oneOffOwnerId }` — the shape
 * every query already produces, so call sites stay one line.
 */
export function sessionRef(session: {
  club?: { ownerId: string | null; cosponsorId?: string | null } | null;
  oneOffOwnerId?: string | null;
}): CoverageSessionRef {
  return {
    ownerId: session.club?.ownerId ?? null,
    cosponsorId: session.club?.cosponsorId ?? null,
    oneOffOwnerId: session.oneOffOwnerId ?? null,
  };
}

export type CoverageRow = {
  rotation: RotationSlot;
  primaryTeacherId: string | null;
  secondaryTeacherId: string | null;
  /**
   * The admin explicitly decided this rotation needs no second teacher, which
   * suppresses the cosponsor fallback. Required: a query that omits it would
   * otherwise compile and silently re-derive a cosponsor the admin removed.
   */
  secondaryCleared: boolean;
  /**
   * The same decision for T1, suppressing the owner fallback. Required for the
   * same reason — and this one was learned the hard way: without it, clearing T1
   * saved a null that the fallback immediately overwrote with the club's owner,
   * so the Coverage page said "Saved" and reverted on reload.
   */
  primaryCleared: boolean;
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
 * Prisma `select` for a session's coverage rows. Spread this rather than listing
 * columns by hand — it is what keeps `CoverageRow` satisfiable everywhere.
 */
export const SESSION_COVERAGE_SELECT = {
  rotation: true,
  primaryTeacherId: true,
  secondaryTeacherId: true,
  secondaryCleared: true,
  primaryCleared: true,
} as const;

/** Prisma `select` for a session's teacher absences. */
export const SESSION_ABSENCE_SELECT = {
  teacherId: true,
  rotation: true,
} as const;

/**
 * Effective T1/T2 for one rotation of one session.
 *
 * With no explicit assignment, T1 falls back to the club's owner, or for a one-off
 * session to its creator. A club with no owner and no assignment resolves to null,
 * which the Coverage page surfaces as needing cover.
 */
export function resolveSessionCoverage(
  session: CoverageSessionRef | null | undefined,
  rows: CoverageRow[],
  rotation: RotationSlot,
  absences: AbsenceRow[]
): ResolvedCoverage {
  const row = rows.find((r) => r.rotation === rotation);
  const absent = new Set(
    absences.filter((a) => a.rotation === rotation).map((a) => a.teacherId)
  );

  const primaryDefault = row?.primaryCleared
    ? null
    : (session?.ownerId ?? session?.oneOffOwnerId ?? null);
  const primary = row?.primaryTeacherId ?? primaryDefault;

  const secondaryDefault = row?.secondaryCleared
    ? null
    : (session?.cosponsorId ?? null);
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
  session: CoverageSessionRef | null | undefined,
  rows: CoverageRow[],
  rotations: RotationSlot[],
  absences: AbsenceRow[]
): Set<string> {
  const ids = new Set<string>();
  for (const rotation of rotations) {
    const { primaryTeacherId, secondaryTeacherId } = resolveSessionCoverage(
      session,
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
 * the same rotation by two different sessions cannot attend both. Because the
 * defaults above include a one-off's creator, running a one-off opposite your own
 * club now registers as a clash — it previously did not.
 */
export function rotationsExpectingTeacher(
  session: CoverageSessionRef | null | undefined,
  rows: CoverageRow[],
  rotations: RotationSlot[],
  absences: AbsenceRow[],
  teacherId: string
): RotationSlot[] {
  return rotations.filter((rotation) => {
    const { primaryTeacherId, secondaryTeacherId } = resolveSessionCoverage(
      session,
      rows,
      rotation,
      absences
    );
    return primaryTeacherId === teacherId || secondaryTeacherId === teacherId;
  });
}

/**
 * One thing a teacher is expected at during a Flex Day.
 *
 * Deliberately neutral about *what* it is. A club session supplies its coverage
 * rows and absences and lets the fallbacks resolve; a duty post supplies an
 * already-decided teacher and empty rows. Both are places a person has to
 * physically stand, which is the only property that matters for a clash, so both
 * go through one function rather than each growing its own comparison.
 */
export type ExpectedPlacement = {
  /** Opaque to this module — a session id, or a duty post + rotation key. */
  id: string;
  name: string;
  rotations: RotationSlot[];
  session: CoverageSessionRef | null;
  rows: CoverageRow[];
  absences: AbsenceRow[];
};

/** One teacher expected in two or more places during the same rotation. */
export type TeacherClash = {
  rotation: RotationSlot;
  teacherId: string;
  /** Always two or more, in the order the placements were supplied. */
  placements: { id: string; name: string }[];
};

/**
 * Every teacher double-booked across a Flex Day.
 *
 * Nobody can be in two rooms at once, and until this existed no admin was ever
 * told when that had happened. The teacher's own dashboard has warned them since
 * clashes were introduced, but it is scoped to the logged-in user, so the one
 * screen where an admin assigns coverage — and where a clash is most easily
 * *created* — showed two ordinary green cards with the same name in the same
 * column.
 *
 * The common case needs no dropdown to have been touched at all: a teacher who
 * owns two clubs is the fallback T1 for both, so scheduling both in one rotation
 * double-books them silently.
 *
 * Absences are subtracted by `resolveSessionCoverage` before they get here, so
 * marking a teacher "not here" for one placement resolves the clash — which is
 * what makes that the natural fix to offer beside the warning.
 */
export function findTeacherClashes(
  placements: ExpectedPlacement[],
  rotations: RotationSlot[]
): TeacherClash[] {
  const clashes: TeacherClash[] = [];

  for (const rotation of rotations) {
    // teacherId -> the placements expecting them this rotation.
    const expecting = new Map<string, { id: string; name: string }[]>();

    for (const placement of placements) {
      if (!placement.rotations.includes(rotation)) continue;

      const { primaryTeacherId, secondaryTeacherId } = resolveSessionCoverage(
        placement.session,
        placement.rows,
        rotation,
        placement.absences
      );

      // A teacher filling both slots of one placement is standing in one room,
      // so dedupe within a placement before counting.
      for (const teacherId of new Set(
        [primaryTeacherId, secondaryTeacherId].filter(
          (id): id is string => id !== null
        )
      )) {
        const list = expecting.get(teacherId) ?? [];
        list.push({ id: placement.id, name: placement.name });
        expecting.set(teacherId, list);
      }
    }

    for (const [teacherId, involved] of expecting) {
      if (involved.length > 1) {
        clashes.push({ rotation, teacherId, placements: involved });
      }
    }
  }

  return clashes;
}

/**
 * Adapt a club session row to a placement. Keeps the mapping in one place, since
 * both the admin Coverage page and the teacher dashboard need it.
 */
export function sessionPlacement(session: {
  id: string;
  rotations: RotationSlot[];
  title?: string | null;
  club?: { name?: string; ownerId: string | null; cosponsorId?: string | null } | null;
  oneOffOwnerId?: string | null;
  rotationCoverage: CoverageRow[];
  teacherAbsences: AbsenceRow[];
}): ExpectedPlacement {
  return {
    id: session.id,
    name: session.title ?? session.club?.name ?? "Session",
    rotations: session.rotations,
    session: sessionRef(session),
    rows: session.rotationCoverage,
    absences: session.teacherAbsences,
  };
}
