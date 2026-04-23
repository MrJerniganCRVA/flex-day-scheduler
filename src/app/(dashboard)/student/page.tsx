import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ROTATION_LABELS, ALL_ROTATIONS } from "@/types";
import { getSignupDeadline, isPastSignupDeadline } from "@/lib/flex-day-utils";
import FlexDaySignupView from "@/components/student/FlexDaySignupView";
import type { SessionViewData } from "@/components/student/FlexDaySignupView";
import type { RotationSlot } from "@prisma/client";

export default async function StudentDashboard() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  // Next upcoming flex day with all club sessions
  const nextFlexDay = await prisma.flexDay.findFirst({
    where: { isActive: true, date: { gte: today } },
    orderBy: { date: "asc" },
    include: {
      clubSessions: {
        include: {
          club: {
            select: {
              id: true,
              name: true,
              description: true,
              maxCapacity: true,
              owner: { select: { name: true } },
            },
          },
          oneOffOwner: { select: { name: true } },
          _count: { select: { signups: true } },
          signups: {
            where: { studentId: session.user.id },
            select: { id: true },
          },
        },
      },
    },
  });

  if (!nextFlexDay) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">
          Welcome, {session.user.name?.split(" ")[0]}!
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mb-6 text-sm">
          No upcoming Flex Days scheduled. Check back later!
        </p>
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 p-12 text-center text-gray-400 dark:text-gray-500">
          Your next Flex Day will appear here once scheduled.
        </div>
      </div>
    );
  }

  // Track which rotations the student already has signups for
  const bookedRotations = new Set<RotationSlot>();
  const mySignups: Array<{ clubName: string; rotations: RotationSlot[] }> = [];
  for (const cs of nextFlexDay.clubSessions) {
    if (cs.signups.length > 0) {
      mySignups.push({
        clubName: cs.title ?? cs.club?.name ?? "Session",
        rotations: cs.rotations,
      });
      for (const r of cs.rotations) bookedRotations.add(r);
    }
  }

  const deadline = getSignupDeadline(nextFlexDay.date);
  const pastDeadline = isPastSignupDeadline(nextFlexDay.date);

  // Map sessions to serializable shape for the client component
  const sessions: SessionViewData[] = nextFlexDay.clubSessions.map((cs) => {
    const capacity = cs.capacityOverride ?? cs.club?.maxCapacity ?? 0;
    const isFull = cs._count.signups >= capacity;
    const isMySignup = cs.signups.length > 0;
    const conflictingRotation = cs.rotations.find((r) => bookedRotations.has(r));
    return {
      id: cs.id,
      sessionName: cs.title ?? cs.club?.name ?? "Session",
      description: cs.club?.description ?? null,
      teacherName: cs.oneOffOwner?.name ?? cs.club?.owner.name ?? null,
      rotations: cs.rotations,
      enrolledCount: cs._count.signups,
      capacity,
      isMySignup,
      signupId: cs.signups[0]?.id,
      isFull,
      isConflicted: !isMySignup && cs.rotations.some((r) => bookedRotations.has(r)),
      conflictLabel: conflictingRotation
        ? `You're in ${ROTATION_LABELS[conflictingRotation]}`
        : undefined,
      spansRotations: cs.rotations.length > 1,
    };
  });

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">
        Welcome, {session.user.name?.split(" ")[0]}!
      </h1>
      <p className="text-gray-500 dark:text-gray-400 mb-6 text-sm">
        Sign up for clubs for the next Flex Day below.
      </p>

      {/* Signed-up clubs summary */}
      {mySignups.length > 0 && (
        <div className="mb-4 rounded-lg border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950/30 p-4">
          <div className="font-medium text-sm text-green-800 dark:text-green-200 mb-1">
            Your Signups:
          </div>
          <ul className="space-y-1">
            {mySignups.map((signup, idx) => (
              <li key={idx} className="text-sm text-green-700 dark:text-green-300">
                <span className="font-medium">{signup.clubName}</span>
                {" — "}
                {signup.rotations.map((r) => ROTATION_LABELS[r]).join(", ")}
              </li>
            ))}
          </ul>
        </div>
      )}

      <FlexDaySignupView
        sessions={sessions}
        deadlineISO={deadline.toISOString()}
        isPastDeadlineOnLoad={pastDeadline}
        flexDayDateISO={nextFlexDay.date.toISOString()}
        flexDayLabel={nextFlexDay.label ?? null}
      />

      <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
        <Link
          href="/student/my-signups"
          className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          View all my signups →
        </Link>
      </div>
    </div>
  );
}
