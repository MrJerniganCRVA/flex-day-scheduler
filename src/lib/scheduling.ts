import prisma from "@/lib/prisma";
import { enrollRequiredMembers } from "@/lib/required-members-io";
import type { RotationSlot } from "@prisma/client";
import {
  desiredSessionShapes,
  planReconcile,
  type ReconcileReport,
  type ReconcileSkip,
} from "@/lib/reconcile";

export {
  desiredSessionShapes,
  planReconcile,
  type ReconcileReport,
  type ReconcileSkip,
};

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
 *
 * The club's required members are enrolled into whatever this creates. That
 * belongs here rather than in the two callers (POST /api/flex-days and
 * POST /api/clubs) because a required member who is only enrolled on some of the
 * paths that make sessions is worse than one who is never enrolled at all — the
 * roster looks right until the one day it doesn't.
 */
export async function createAutoScheduledSessions(
  club: {
    id: string;
    defaultRotations: RotationSlot[];
    linkedRotations: boolean;
  },
  flexDayId: string
) {
  const sessions = club.linkedRotations
    ? [
        await prisma.clubSession.create({
          data: {
            flexDayId,
            clubId: club.id,
            rotations: club.defaultRotations,
          },
        }),
      ]
    : await Promise.all(
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

  await enrollRequiredMembers({
    clubId: club.id,
    sessionIds: sessions.map((s) => s.id),
  });

  return sessions;
}

/**
 * Bring a club's sessions on all future flex days into line with its current
 * default rotations.
 *
 * Sessions were previously only ever generated at creation time — when a flex day
 * was added, or when a club was created. Editing a club's rotations afterwards
 * changed the Club row and nothing else, so a club whose sessions already existed
 * stayed frozen in its original shape forever. This is the missing third entry
 * point.
 *
 * Past flex days are never touched: their sessions are history.
 */
export async function reconcileFutureSessions(club: {
  id: string;
  defaultRotations: RotationSlot[];
  linkedRotations: boolean;
}): Promise<ReconcileReport> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const flexDays = await prisma.flexDay.findMany({
    where: { date: { gte: today }, isActive: true },
    select: {
      id: true,
      date: true,
      isFinalized: true,
      clubSessions: {
        where: { clubId: club.id },
        select: {
          id: true,
          rotations: true,
          googleEventId: true,
          _count: { select: { signups: true } },
        },
      },
    },
    orderBy: { date: "asc" },
  });

  const desired = desiredSessionShapes(club);

  const report: ReconcileReport = {
    created: 0,
    deleted: 0,
    flexDaysTouched: 0,
    skipped: [],
  };

  for (const flexDay of flexDays) {
    const { toCreate, toDelete, skipped } = planReconcile({
      existing: flexDay.clubSessions,
      desired,
      flexDayFinalized: flexDay.isFinalized,
      flexDayDate: flexDay.date,
    });

    report.skipped.push(...skipped);
    if (toCreate.length === 0 && toDelete.length === 0) continue;

    // One transaction per flex day: a failure part-way through leaves earlier
    // days correct rather than rolling back the whole sweep.
    const createdIds = await prisma.$transaction(async (tx) => {
      if (toDelete.length > 0) {
        await tx.clubSession.deleteMany({ where: { id: { in: toDelete } } });
      }
      const ids: string[] = [];
      for (const rotations of toCreate) {
        const created = await tx.clubSession.create({
          data: { flexDayId: flexDay.id, clubId: club.id, rotations },
        });
        ids.push(created.id);
      }
      return ids;
    });

    // Reshaping a club's rotations makes new sessions, and a required member
    // belongs in those too — otherwise editing a club silently drops its
    // mandatory roster for every day it touches.
    if (createdIds.length > 0) {
      await enrollRequiredMembers({ clubId: club.id, sessionIds: createdIds });
    }

    report.created += toCreate.length;
    report.deleted += toDelete.length;
    report.flexDaysTouched += 1;
  }

  return report;
}
