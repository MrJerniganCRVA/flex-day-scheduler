import type { RotationSlot } from "@prisma/client";

/**
 * Upcoming Flex Days on which a club is missing some or all of its default
 * rotations — almost always because a teacher used "Remove from Day" and
 * later needs the session back.
 *
 * Removing a session deletes the row, and the club page only lists days that
 * have sessions, so without this a removed day vanished with no way back.
 *
 * Finalized days are left out on purpose: their calendar invites have already
 * gone out, and an admin unfinalizes the day before anything is added to it.
 *
 * Pure so it can be tested without a database; the query lives in
 * loadMissingFlexDays in scheduling.ts.
 */
export interface MissingFlexDay {
  id: string;
  date: Date;
  label: string | null;
  missingRotations: RotationSlot[];
}

export function findMissingFlexDays(params: {
  defaultRotations: RotationSlot[];
  flexDays: {
    id: string;
    date: Date;
    label: string | null;
    isFinalized: boolean;
    sessions: { rotations: RotationSlot[] }[];
  }[];
}): MissingFlexDay[] {
  const { defaultRotations, flexDays } = params;
  const result: MissingFlexDay[] = [];

  for (const day of flexDays) {
    if (day.isFinalized) continue;
    const covered = new Set(day.sessions.flatMap((s) => s.rotations));
    const missingRotations = defaultRotations.filter((r) => !covered.has(r));
    if (missingRotations.length === 0) continue;
    result.push({ id: day.id, date: day.date, label: day.label, missingRotations });
  }

  return result;
}
