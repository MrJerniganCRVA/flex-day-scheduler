import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
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

  return NextResponse.json({
    totalStudents: students.length,
    fullyUnassigned,
    partiallyAssigned,
    studentsNeedingSlots: fullyUnassigned + partiallyAssigned,
    sessionsEligible: eligible.length,
    totalSessions: allSessions.length,
    excludedClubs,
    proposedAssignments,
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
    return NextResponse.json({ signupsCreated: 0, studentsAffected: 0, skipped: [] });
  }

  type SkipReason =
    | "invalid_session"
    | "invalid_student"
    | "capacity_full"
    | "rotation_conflict"
    | "already_signed_up";
  type Skipped = { studentId: string; clubSessionId: string; reason: SkipReason };

  // The dry-run (GET) proposals can go stale between admin review and commit
  // (students self-signing up, capacity filling), so re-validate every row
  // against live data here rather than trusting the client-submitted list.
  // Serializable isolation prevents this from racing a concurrent /api/signups
  // call the same way the regular signup endpoint is protected.
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await prisma.$transaction(
        async (tx) => {
          const sessions = await tx.clubSession.findMany({
            where: { flexDayId, id: { in: rows.map((r) => r.clubSessionId) } },
            select: {
              id: true,
              rotations: true,
              capacityOverride: true,
              club: { select: { maxCapacity: true } },
              _count: { select: { signups: true } },
            },
          });
          const sessionById = new Map(sessions.map((s) => [s.id, s]));

          const studentIds = [...new Set(rows.map((r) => r.studentId))];
          const validStudents = await tx.user.findMany({
            where: { id: { in: studentIds }, role: "STUDENT" },
            select: { id: true },
          });
          const validStudentIds = new Set(validStudents.map((s) => s.id));

          // Rotations each student already occupies on this flex day, so we
          // don't double-book a student into a rotation they're already in.
          const existingSignups = await tx.signup.findMany({
            where: { studentId: { in: studentIds }, clubSession: { flexDayId } },
            select: {
              studentId: true,
              clubSession: { select: { rotations: true } },
            },
          });
          const occupiedRotations = new Map<string, Set<RotationSlot>>();
          for (const s of existingSignups) {
            const set = occupiedRotations.get(s.studentId) ?? new Set<RotationSlot>();
            for (const r of s.clubSession.rotations as RotationSlot[]) set.add(r);
            occupiedRotations.set(s.studentId, set);
          }

          // Running enrolled counts, seeded from the DB and updated as rows are accepted.
          const enrolledCount = new Map(sessions.map((s) => [s.id, s._count.signups]));

          const accepted: { studentId: string; clubSessionId: string }[] = [];
          const skipped: Skipped[] = [];

          for (const row of rows) {
            const targetSession = sessionById.get(row.clubSessionId);
            if (!targetSession) {
              skipped.push({ ...row, reason: "invalid_session" });
              continue;
            }
            if (!validStudentIds.has(row.studentId)) {
              skipped.push({ ...row, reason: "invalid_student" });
              continue;
            }

            const capacity =
              targetSession.capacityOverride ?? targetSession.club?.maxCapacity ?? 0;
            const currentCount = enrolledCount.get(row.clubSessionId) ?? 0;
            if (currentCount >= capacity) {
              skipped.push({ ...row, reason: "capacity_full" });
              continue;
            }

            const studentOccupied =
              occupiedRotations.get(row.studentId) ?? new Set<RotationSlot>();
            const hasConflict = (targetSession.rotations as RotationSlot[]).some((r) =>
              studentOccupied.has(r)
            );
            if (hasConflict) {
              skipped.push({ ...row, reason: "rotation_conflict" });
              continue;
            }

            accepted.push(row);
            enrolledCount.set(row.clubSessionId, currentCount + 1);
            for (const r of targetSession.rotations as RotationSlot[]) studentOccupied.add(r);
            occupiedRotations.set(row.studentId, studentOccupied);
          }

          let signupsCreated = 0;
          const affectedStudentIds = new Set<string>();
          for (const row of accepted) {
            try {
              await tx.signup.create({ data: row });
              signupsCreated++;
              affectedStudentIds.add(row.studentId);
            } catch (err) {
              if (
                err instanceof Prisma.PrismaClientKnownRequestError &&
                err.code === "P2002"
              ) {
                skipped.push({ ...row, reason: "already_signed_up" });
              } else {
                throw err;
              }
            }
          }

          return {
            signupsCreated,
            studentsAffected: affectedStudentIds.size,
            skipped,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );

      return NextResponse.json(result);
    } catch (error) {
      const isSerializationConflict =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
      if (isSerializationConflict && attempt < MAX_ATTEMPTS) {
        continue;
      }
      if (isSerializationConflict) {
        return NextResponse.json(
          {
            error:
              "Enrollment changed while committing these assignments. Please re-run the dry run and try again.",
          },
          { status: 409 }
        );
      }
      throw error;
    }
  }

  // Unreachable: the loop above always returns or throws.
  throw new Error("Unreachable");
}
