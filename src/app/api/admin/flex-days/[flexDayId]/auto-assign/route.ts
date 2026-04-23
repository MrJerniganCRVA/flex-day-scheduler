import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import type { RotationSlot } from "@prisma/client";

const ALL_ROTATIONS: RotationSlot[] = ["FLEX_1", "FLEX_2", "FLEX_3"];

function weightedRandom<T>(items: T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

// GET — preview stats before running
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

  const [students, signups, allSessions] = await Promise.all([
    prisma.user.findMany({ where: { role: "STUDENT" }, select: { id: true } }),
    prisma.signup.findMany({
      where: { clubSession: { flexDayId } },
      select: { studentId: true, clubSession: { select: { rotations: true } } },
    }),
    prisma.clubSession.findMany({
      where: { flexDayId },
      select: {
        id: true,
        clubId: true,
        title: true,
        capacityOverride: true,
        club: { select: { name: true, maxCapacity: true, allowRandomAssignment: true } },
        _count: { select: { signups: true } },
      },
    }),
  ]);

  // Per-student covered rotations
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

  // Eligible: club sessions with allowRandomAssignment=true, OR one-off sessions (no club)
  const eligible = allSessions.filter((cs) => {
    if (cs.clubId !== null && !cs.club?.allowRandomAssignment) return false;
    const cap = cs.capacityOverride ?? cs.club?.maxCapacity ?? 0;
    return cap > cs._count.signups;
  });

  const excludedClubs = allSessions
    .filter((cs) => cs.clubId !== null && !cs.club?.allowRandomAssignment)
    .map((cs) => cs.club!.name)
    .filter((v, i, a) => a.indexOf(v) === i);

  return NextResponse.json({
    totalStudents: students.length,
    fullyUnassigned,
    partiallyAssigned,
    studentsNeedingSlots: fullyUnassigned + partiallyAssigned,
    sessionsEligible: eligible.length,
    totalSessions: allSessions.length,
    excludedClubs,
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

  const [allSessions, students, existingSignups] = await Promise.all([
    prisma.clubSession.findMany({
      where: { flexDayId },
      include: {
        club: { select: { id: true, name: true, maxCapacity: true, allowRandomAssignment: true } },
        signups: { select: { studentId: true } },
        _count: { select: { signups: true } },
      },
    }),
    prisma.user.findMany({
      where: { role: "STUDENT" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.signup.findMany({
      where: { clubSession: { flexDayId } },
      select: {
        studentId: true,
        clubSession: { select: { id: true, rotations: true, clubId: true } },
      },
    }),
  ]);

  // Eligible sessions: club sessions that allow random assignment + ALL one-off sessions
  // For diversity tracking, use clubId for regular sessions, sessionId for one-offs
  // (so two different one-offs are treated as distinct "clubs" for diversity purposes)
  type SessionEntry = {
    id: string;
    diversityKey: string;
    displayName: string;
    rotations: RotationSlot[];
    capacity: number;
    enrolledCount: number;
    enrolledStudents: Set<string>;
  };

  const sessionPool: SessionEntry[] = allSessions
    .filter((cs) => {
      if (cs.clubId !== null && !cs.club?.allowRandomAssignment) return false;
      const cap = cs.capacityOverride ?? cs.club?.maxCapacity ?? 0;
      return cap > 0;
    })
    .map((cs) => ({
      id: cs.id,
      diversityKey: cs.clubId ?? cs.id,
      displayName: cs.title ?? cs.club?.name ?? "Session",
      rotations: cs.rotations as RotationSlot[],
      capacity: cs.capacityOverride ?? cs.club?.maxCapacity ?? 0,
      enrolledCount: cs._count.signups,
      enrolledStudents: new Set(cs.signups.map((s) => s.studentId)),
    }));

  // Build per-student existing signup state
  type StudentState = {
    name: string;
    coveredRotations: Set<RotationSlot>;
    assignedKeys: Set<string>; // diversityKey from existing signups
  };

  const studentState = new Map<string, StudentState>();
  for (const s of students) {
    studentState.set(s.id, {
      name: s.name,
      coveredRotations: new Set(),
      assignedKeys: new Set(),
    });
  }

  // Build a sessionId → diversityKey lookup from allSessions for existing signup state
  const sessionKeyMap = new Map(
    allSessions.map((cs) => [cs.id, cs.clubId ?? cs.id])
  );

  for (const { studentId, clubSession } of existingSignups) {
    const state = studentState.get(studentId);
    if (!state) continue;
    for (const r of clubSession.rotations as RotationSlot[]) {
      state.coveredRotations.add(r);
    }
    const key = sessionKeyMap.get(clubSession.id) ?? clubSession.clubId ?? clubSession.id;
    state.assignedKeys.add(key);
  }

  // Assignment algorithm
  type AssignmentRecord = {
    studentId: string;
    studentName: string;
    clubSessionId: string;
    sessionName: string;
    rotations: RotationSlot[];
  };

  const assignments: AssignmentRecord[] = [];

  for (const { id: studentId } of students) {
    const state = studentState.get(studentId)!;
    const remainingSlots = new Set(
      ALL_ROTATIONS.filter((r) => !state.coveredRotations.has(r))
    );
    if (remainingSlots.size === 0) continue;

    // Copy assignedKeys so we can track within this run without mutating the shared state
    const assignedKeys = new Set(state.assignedKeys);
    const pickedSessionIds = new Set<string>();

    while (remainingSlots.size > 0) {
      const currentSlot = ALL_ROTATIONS.find((r) => remainingSlots.has(r))!;

      let candidates = sessionPool.filter(
        (cs) =>
          cs.enrolledCount < cs.capacity &&
          !cs.enrolledStudents.has(studentId) &&
          !pickedSessionIds.has(cs.id) &&
          cs.rotations.includes(currentSlot) &&
          cs.rotations.every((r) => remainingSlots.has(r))
      );

      // Diversity: on the last remaining slot, if all assignments so far share the same
      // diversity key, prefer a different one (relax if no alternative exists)
      if (remainingSlots.size === 1 && assignedKeys.size === 1) {
        const [onlyKey] = assignedKeys;
        const diverse = candidates.filter((cs) => cs.diversityKey !== onlyKey);
        if (diverse.length > 0) candidates = diverse;
      }

      if (candidates.length === 0) {
        remainingSlots.delete(currentSlot);
        continue;
      }

      const weights = candidates.map((cs) =>
        Math.max(0.05, 1 - cs.enrolledCount / cs.capacity)
      );
      const picked = weightedRandom(candidates, weights);

      assignments.push({
        studentId,
        studentName: state.name,
        clubSessionId: picked.id,
        sessionName: picked.displayName,
        rotations: [...picked.rotations],
      });

      pickedSessionIds.add(picked.id);
      for (const r of picked.rotations) remainingSlots.delete(r);
      assignedKeys.add(picked.diversityKey);

      // Update pool so later students see accurate fill levels
      picked.enrolledCount++;
      picked.enrolledStudents.add(studentId);
    }
  }

  let createdCount = 0;
  if (assignments.length > 0) {
    const result = await prisma.signup.createMany({
      data: assignments.map((a) => ({
        studentId: a.studentId,
        clubSessionId: a.clubSessionId,
      })),
      skipDuplicates: true,
    });
    createdCount = result.count;
  }

  // Build per-student breakdown for the UI
  const breakdownMap = new Map<
    string,
    { studentName: string; sessions: { name: string; rotations: RotationSlot[] }[] }
  >();
  for (const a of assignments) {
    if (!breakdownMap.has(a.studentId)) {
      breakdownMap.set(a.studentId, { studentName: a.studentName, sessions: [] });
    }
    breakdownMap.get(a.studentId)!.sessions.push({
      name: a.sessionName,
      rotations: a.rotations,
    });
  }

  return NextResponse.json({
    signupsCreated: createdCount,
    studentsAffected: breakdownMap.size,
    breakdown: Array.from(breakdownMap.values()),
  });
}
