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

type SessionEntry = {
  id: string;
  diversityKey: string;
  displayName: string;
  rotations: RotationSlot[];
  capacity: number;
  enrolledCount: number;
  enrolledStudents: Set<string>;
};

export type ProposedAssignment = {
  studentId: string;
  studentName: string | null;
  clubSessionId: string;
  sessionName: string;
  rotations: RotationSlot[];
};

function runAssignmentAlgorithm(
  students: { id: string; name: string | null }[],
  studentState: Map<string, { coveredRotations: Set<RotationSlot>; assignedKeys: Set<string> }>,
  sessionPool: SessionEntry[]
): ProposedAssignment[] {
  const assignments: ProposedAssignment[] = [];

  for (const { id: studentId, name: studentName } of students) {
    const state = studentState.get(studentId)!;
    const remainingSlots = new Set(
      ALL_ROTATIONS.filter((r) => !state.coveredRotations.has(r))
    );
    if (remainingSlots.size === 0) continue;

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

      // Diversity: on the last remaining slot, prefer a different club if possible
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
        studentName,
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

  return assignments;
}

async function loadFlexDayData(flexDayId: string) {
  return Promise.all([
    prisma.clubSession.findMany({
      where: { flexDayId },
      include: {
        club: {
          select: {
            id: true,
            name: true,
            maxCapacity: true,
            allowRandomAssignment: true,
          },
        },
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
}

// GET — dry-run: runs the algorithm in memory and returns proposed placements for admin review
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

  const [allSessions, students, existingSignups] = await loadFlexDayData(flexDayId);

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

  const sessionKeyMap = new Map(
    allSessions.map((cs) => [cs.id, cs.clubId ?? cs.id])
  );

  const studentState = new Map<
    string,
    { coveredRotations: Set<RotationSlot>; assignedKeys: Set<string> }
  >();
  for (const s of students) {
    studentState.set(s.id, { coveredRotations: new Set(), assignedKeys: new Set() });
  }
  for (const { studentId, clubSession } of existingSignups) {
    const state = studentState.get(studentId);
    if (!state) continue;
    for (const r of clubSession.rotations as RotationSlot[]) {
      state.coveredRotations.add(r);
    }
    const key = sessionKeyMap.get(clubSession.id) ?? clubSession.clubId ?? clubSession.id;
    state.assignedKeys.add(key);
  }

  let fullyUnassigned = 0;
  let partiallyAssigned = 0;
  for (const { id } of students) {
    const covered = studentState.get(id)?.coveredRotations ?? new Set();
    const missing = ALL_ROTATIONS.filter((r) => !covered.has(r)).length;
    if (missing === ALL_ROTATIONS.length) fullyUnassigned++;
    else if (missing > 0) partiallyAssigned++;
  }

  const eligible = sessionPool.filter((cs) => cs.enrolledCount < cs.capacity);

  const excludedClubs = allSessions
    .filter((cs) => cs.clubId !== null && !cs.club?.allowRandomAssignment)
    .map((cs) => cs.club!.name)
    .filter((v, i, a) => a.indexOf(v) === i);

  const proposedAssignments = runAssignmentAlgorithm(students, studentState, sessionPool);

  // Build per-rotation session lists for dropdown options
  const sessionsPerRotation: Record<RotationSlot, { id: string; name: string }[]> = {
    FLEX_1: [],
    FLEX_2: [],
    FLEX_3: [],
  };
  const seenPerRotation: Record<RotationSlot, Set<string>> = {
    FLEX_1: new Set(),
    FLEX_2: new Set(),
    FLEX_3: new Set(),
  };
  for (const cs of sessionPool) {
    for (const r of cs.rotations) {
      if (!seenPerRotation[r].has(cs.id)) {
        seenPerRotation[r].add(cs.id);
        sessionsPerRotation[r].push({ id: cs.id, name: cs.displayName });
      }
    }
  }

  return NextResponse.json({
    totalStudents: students.length,
    fullyUnassigned,
    partiallyAssigned,
    studentsNeedingSlots: fullyUnassigned + partiallyAssigned,
    sessionsEligible: eligible.length,
    totalSessions: allSessions.length,
    excludedClubs,
    proposedAssignments,
    sessionsPerRotation,
  });
}

// POST — commit the admin-reviewed proposed assignments to the database
export async function POST(
  req: NextRequest,
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

  const body = await req.json().catch(() => null);
  const assignments: unknown = body?.assignments;
  if (
    !Array.isArray(assignments) ||
    assignments.some(
      (a) =>
        typeof a !== "object" ||
        a === null ||
        typeof (a as Record<string, unknown>).studentId !== "string" ||
        typeof (a as Record<string, unknown>).clubSessionId !== "string"
    )
  ) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const rows = assignments as { studentId: string; clubSessionId: string }[];

  if (rows.length === 0) {
    return NextResponse.json({ signupsCreated: 0, studentsAffected: 0 });
  }

  const result = await prisma.signup.createMany({
    data: rows,
    skipDuplicates: true,
  });

  return NextResponse.json({
    signupsCreated: result.count,
    studentsAffected: new Set(rows.map((r) => r.studentId)).size,
  });
}
