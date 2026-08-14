import prisma from "@/lib/prisma";
import type { RotationSlot } from "@prisma/client";

/**
 * Room ids occupied by another ClubSession on the given flex day whose
 * rotations overlap the given ones. Each session's occupied room resolves
 * to its roomOverrideId if set, else its club's defaultRoomId (one-off
 * sessions always carry a roomOverrideId and have no club).
 */
export async function getOccupiedRoomIds(params: {
  flexDayId: string;
  rotations: RotationSlot[];
  excludeSessionId?: string;
}): Promise<Set<string>> {
  const { flexDayId, rotations, excludeSessionId } = params;
  if (rotations.length === 0) return new Set();

  const sessions = await prisma.clubSession.findMany({
    where: {
      flexDayId,
      ...(excludeSessionId ? { id: { not: excludeSessionId } } : {}),
      rotations: { hasSome: rotations },
    },
    select: {
      roomOverrideId: true,
      club: { select: { defaultRoomId: true } },
    },
  });

  const occupied = new Set<string>();
  for (const s of sessions) {
    const roomId = s.roomOverrideId ?? s.club?.defaultRoomId ?? null;
    if (roomId) occupied.add(roomId);
  }
  return occupied;
}

/**
 * Room ids already claimed as another club's default room where that
 * club's default rotations overlap the given ones. Day-agnostic — used
 * when picking a club's recurring default room/rotations, before any
 * specific flex day exists.
 */
export async function getDefaultRoomConflictIds(params: {
  rotations: RotationSlot[];
  excludeClubId?: string;
}): Promise<Set<string>> {
  const { rotations, excludeClubId } = params;
  if (rotations.length === 0) return new Set();

  const clubs = await prisma.club.findMany({
    where: {
      ...(excludeClubId ? { id: { not: excludeClubId } } : {}),
      defaultRoomId: { not: null },
      defaultRotations: { hasSome: rotations },
    },
    select: { defaultRoomId: true },
  });

  return new Set(clubs.map((c) => c.defaultRoomId!));
}

/**
 * Create the ClubSession row(s) for a club auto-scheduled onto one flex day.
 * Linked clubs get a single session spanning all default rotations (shared
 * roster); unlinked clubs get one independent session per rotation. Never
 * touches Google Calendar — event creation is deferred to finalize.
 */
export async function createAutoScheduledSessions(
  club: {
    id: string;
    defaultRotations: RotationSlot[];
    linkedRotations: boolean;
  },
  flexDayId: string
) {
  if (club.linkedRotations) {
    const session = await prisma.clubSession.create({
      data: {
        flexDayId,
        clubId: club.id,
        rotations: club.defaultRotations,
      },
    });
    return [session];
  }

  return Promise.all(
    club.defaultRotations.map((rotation) =>
      prisma.clubSession.create({
        data: {
          flexDayId,
          clubId: club.id,
          rotations: [rotation],
        },
      })
    )
  );
}
