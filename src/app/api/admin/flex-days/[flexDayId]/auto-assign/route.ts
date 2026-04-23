import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import type { RotationSlot } from "@prisma/client";

const ALL_ROTATIONS: RotationSlot[] = ["FLEX_1", "FLEX_2", "FLEX_3"];

/** Weighted random pick: items[i] gets weight proportional to weights[i]. */
function weightedRandom<T>(items: T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

// GET — preview: how many students are unassigned / partially assigned
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ flexDayId: string }> }
) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { flexDayId } = await params;

  const flexDay = await prisma.flexDay.findUnique({
    where: { id: flexDayId },
    select: { id: true },
  });
  if (!flexDay) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [students, signups, excludedClubs, eligibleSessions] = await Promise.all([
    prisma.user.findMany({ where: { role: "STUDENT" }, select: { id: true } }),
    prisma.signup.findMany({
      where: { clubSession: { flexDayId } },
      select: {
        studentId: true,
        clubSession: { select: { rotations: true } },
      },
    }),
    prisma.club.findMany({
      where: { allowRandomAssignment: false },
      select: { name: true },
    }),
    prisma.clubSession.findMany({
      where: { flexDayId, club: { allowRandomAssignment: true } },
      select: {
        id: true,
        rotations: true,
        capacityOverride: true,
        club: { select: { maxCapacity: true } },
        _count: { select: { signups: true } },
      },
    }),
  ]);

  // Build per-student covered rotations
  const coveredMap = new Map<string, Set<RotationSlot>>();
  for (const { studentId, clubSession } of signups) {
    if (!coveredMap.has(studentId)) coveredMap.set(studentId, new Set());
    for (const r of clubSession.rotations) coveredMap.get(studentId)!.add(r);
  }

  let fullyUnassigned = 0;
  let partiallyAssigned = 0;
  for (const { id } of students) {
    const covered = coveredMap.get(id) ?? new Set();
    const missing = ALL_ROTATIONS.filter((r) => !covered.has(r)).length;
    if (missing === ALL_ROTATIONS.length) fullyUnassigned++;
    else if (missing > 0) partiallyAssigned++;
  }

  const sessionsEligible = eligibleSessions.filter((cs) => {
    const cap = cs.capacityOverride ?? cs.club?.maxCapacity ?? 0;
    return cs._count.signups < cap;
  }).length;

  return NextResponse.json({
    totalStudents: students.length,
    fullyUnassigned,
    partiallyAssigned,
    studentsNeedingSlots: fullyUnassigned + partiallyAssigned,
    excludedClubs: excludedClubs.map((c) => c.name),
    sessionsEligible,
  });
}

// POST — run the assignment
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ flexDayId: string }> }
) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { flexDayId } = await params;

  const flexDay = await prisma.flexDay.findUnique({
    where: { id: flexDayId },
    select: { id: true },
  });
  if (!flexDay) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Fetch all club sessions for this flex day that are eligible for random assignment
  const rawSessions = await prisma.clubSession.findMany({
    where: {
      flexDayId,
      club: { allowRandomAssignment: true },
    },
    include: {
      club: { select: { id: true, maxCapacity: true, allowRandomAssignment: true } },
      signups: { select: { studentId: true } },
      _count: { select: { signups: true } },
    },
  });

  // Build mutable session pool with live enrollment tracking
  type SessionEntry = {
    id: string;
    clubId: string | null;
    rotations: RotationSlot[];
    capacity: number;
    enrolledCount: number;
    enrolledStudents: Set<string>;
  };

  const sessionPool: SessionEntry[] = rawSessions
    .filter((cs) => {
      const cap = cs.capacityOverride ?? cs.club?.maxCapacity ?? 0;
      return cap > 0;
    })
    .map((cs) => ({
      id: cs.id,
      clubId: cs.clubId,
      rotations: cs.rotations as RotationSlot[],
      capacity: cs.capacityOverride ?? cs.club?.maxCapacity ?? 0,
      enrolledCount: cs._count.signups,
      enrolledStudents: new Set(cs.signups.map((s) => s.studentId)),
    }));

  // Fetch all students and their existing signups for this flex day
  const [students, existingSignups] = await Promise.all([
    prisma.user.findMany({ where: { role: "STUDENT" }, select: { id: true } }),
    prisma.signup.findMany({
      where: { clubSession: { flexDayId } },
      select: {
        studentId: true,
        clubSession: {
          select: { rotations: true, clubId: true },
        },
      },
    }),
  ]);

  // Build per-student state
  type StudentState = {
    coveredRotations: Set<RotationSlot>;
    assignedClubIds: Set<string>;
  };
  const studentState = new Map<string, StudentState>();
  for (const { id } of students) {
    studentState.set(id, { coveredRotations: new Set(), assignedClubIds: new Set() });
  }
  for (const { studentId, clubSession } of existingSignups) {
    const state = studentState.get(studentId);
    if (!state) continue;
    for (const r of clubSession.rotations as RotationSlot[]) {
      state.coveredRotations.add(r);
    }
    if (clubSession.clubId) state.assignedClubIds.add(clubSession.clubId);
  }

  // Run assignment for each student
  const newSignups: { studentId: string; clubSessionId: string }[] = [];

  for (const { id: studentId } of students) {
    const state = studentState.get(studentId)!;
    const remainingSlots = new Set(
      ALL_ROTATIONS.filter((r) => !state.coveredRotations.has(r))
    );

    if (remainingSlots.size === 0) continue;

    while (remainingSlots.size > 0) {
      const currentSlot = ALL_ROTATIONS.find((r) => remainingSlots.has(r))!;

      // Build eligible pool: session covers currentSlot, all its rotations are
      // unassigned for this student, not full, student not already in it
      let pool = sessionPool.filter(
        (cs) =>
          cs.enrolledCount < cs.capacity &&
          !cs.enrolledStudents.has(studentId) &&
          cs.rotations.includes(currentSlot) &&
          cs.rotations.every((r) => remainingSlots.has(r))
      );

      // Diversity enforcement on the very last remaining slot:
      // if all previously assigned clubs are a single club, force a different one.
      if (remainingSlots.size === 1 && state.assignedClubIds.size === 1) {
        const onlyClub = Array.from(state.assignedClubIds)[0];
        const diversePool = pool.filter((cs) => cs.clubId !== onlyClub);
        if (diversePool.length > 0) pool = diversePool;
      }

      if (pool.length === 0) {
        // No eligible session for this slot — leave unassigned and move on
        remainingSlots.delete(currentSlot);
        continue;
      }

      // Weighted selection: clubs with more open seats get higher weight (floor 0.05)
      const weights = pool.map((cs) =>
        Math.max(0.05, 1 - cs.enrolledCount / cs.capacity)
      );
      const picked = weightedRandom(pool, weights);

      // Record assignment
      newSignups.push({ studentId, clubSessionId: picked.id });

      // Update in-memory state so subsequent iterations see accurate enrollment
      picked.enrolledCount++;
      picked.enrolledStudents.add(studentId);
      for (const r of picked.rotations) remainingSlots.delete(r);
      if (picked.clubId) state.assignedClubIds.add(picked.clubId);
    }
  }

  // Create all signups in a single transaction; skip any that already exist
  let createdCount = 0;
  if (newSignups.length > 0) {
    const result = await prisma.signup.createMany({
      data: newSignups,
      skipDuplicates: true,
    });
    createdCount = result.count;
  }

  const studentsAffected = new Set(newSignups.map((s) => s.studentId)).size;

  return NextResponse.json({
    created: createdCount,
    studentsAffected,
  });
}
