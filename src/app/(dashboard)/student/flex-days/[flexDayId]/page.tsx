import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import { ROTATION_LABELS } from "@/types";
import { getSignupDeadline, isPastSignupDeadline } from "@/lib/flex-day-utils";
import FlexDaySignupView from "@/components/student/FlexDaySignupView";
import type { SessionViewData } from "@/components/student/FlexDaySignupView";
import type { RotationSlot } from "@prisma/client";

export default async function StudentFlexDayPage({
  params,
}: {
  params: Promise<{ flexDayId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { flexDayId } = await params;

  const flexDay = await prisma.flexDay.findUnique({
    where: { id: flexDayId },
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

  if (!flexDay) notFound();

  const bookedRotations = new Set<RotationSlot>();
  const bookedSessionByRotation = new Map<RotationSlot, string>();
  for (const cs of flexDay.clubSessions) {
    if (cs.signups.length > 0) {
      const name = cs.title ?? cs.club?.name ?? "Session";
      for (const r of cs.rotations) {
        bookedRotations.add(r);
        bookedSessionByRotation.set(r, name);
      }
    }
  }

  const deadline = getSignupDeadline(flexDay.date);
  const pastDeadline = isPastSignupDeadline(flexDay.date);

  // Map sessions to serializable shape for the client component
  const sessions: SessionViewData[] = flexDay.clubSessions.map((cs) => {
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
        ? `You have ${bookedSessionByRotation.get(conflictingRotation) ?? "another session"} in ${ROTATION_LABELS[conflictingRotation]}`
        : undefined,
      spansRotations: cs.rotations.length > 1,
    };
  });

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">
        {flexDay.label ??
          new Date(flexDay.date).toLocaleDateString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
            timeZone: "UTC",
          })}
      </h1>
      <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">
        Select a club for each rotation below.
      </p>

      <FlexDaySignupView
        sessions={sessions}
        deadlineISO={deadline.toISOString()}
        isPastDeadlineOnLoad={pastDeadline}
        flexDayDateISO={flexDay.date.toISOString()}
        flexDayLabel={flexDay.label ?? null}
      />
    </div>
  );
}
