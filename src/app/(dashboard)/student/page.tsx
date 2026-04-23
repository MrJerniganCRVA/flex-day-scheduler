import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ROTATION_LABELS, ALL_ROTATIONS } from "@/types";
import SignupButton from "@/components/signups/SignupButton";
import { getSignupDeadline, isPastSignupDeadline } from "@/lib/flex-day-utils";
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

  // Map sessions by rotation
  const rotationMap = new Map<RotationSlot, typeof nextFlexDay.clubSessions>();
  for (const slot of ALL_ROTATIONS) {
    rotationMap.set(
      slot,
      nextFlexDay.clubSessions.filter((s) => s.rotations.includes(slot))
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

      <div className="mb-6 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/50 p-5">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">
          {new Date(nextFlexDay.date).toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
            timeZone: "UTC",
          })}
        </h2>
        {nextFlexDay.label && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
            {nextFlexDay.label}
          </p>
        )}
        <div
          className={`text-xs font-medium mt-2 ${
            pastDeadline
              ? "text-red-600 dark:text-red-400"
              : "text-indigo-600 dark:text-indigo-400"
          }`}
        >
          {pastDeadline ? (
            <>Signups closed</>
          ) : (
            <>
              Signups close:{" "}
              {deadline.toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}{" "}
              at{" "}
              {deadline.toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
              })}
            </>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {ALL_ROTATIONS.map((slot) => {
          const sessions = rotationMap.get(slot) ?? [];
          const isBooked = bookedRotations.has(slot);

          return (
            <div
              key={slot}
              className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 overflow-hidden"
            >
              <div
                className={`px-5 py-3 font-semibold text-sm ${
                  isBooked
                    ? "bg-green-50 dark:bg-green-950/50 text-green-700 dark:text-green-300"
                    : "bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300"
                }`}
              >
                {ROTATION_LABELS[slot]}
                {isBooked && <span className="ml-2 text-xs">(Booked)</span>}
              </div>
              <div className="p-4 space-y-3">
                {sessions.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-gray-200 dark:border-gray-700 p-4 text-center">
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      No clubs scheduled for this rotation.
                    </p>
                    <p className="text-xs text-gray-300 dark:text-gray-600 mt-1">
                      Check the other rotations above.
                    </p>
                  </div>
                ) : (
                  sessions
                    .sort((a, b) => {
                      const aSignedUp = a.signups.length > 0 ? 1 : 0;
                      const bSignedUp = b.signups.length > 0 ? 1 : 0;
                      return bSignedUp - aSignedUp;
                    })
                    .map((cs) => {
                      const capacity = cs.capacityOverride ?? cs.club?.maxCapacity ?? 0;
                      const isFull = cs._count.signups >= capacity;
                      const isMySignup = cs.signups.length > 0;
                      const signupId = cs.signups[0]?.id;
                      const spansRotations = cs.rotations.length > 1;
                      const conflictingRotation = cs.rotations.find((r) =>
                        bookedRotations.has(r)
                      );
                      const conflictLabel = conflictingRotation
                        ? `You're in ${ROTATION_LABELS[conflictingRotation]}`
                        : undefined;
                      const sessionName = cs.title ?? cs.club?.name ?? "Session";
                      const teacherName = cs.oneOffOwner?.name ?? cs.club?.owner.name;

                      return (
                        <div
                          key={cs.id}
                          className={`rounded-lg border p-3 ${
                            isMySignup
                              ? "border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950/30"
                              : "border-gray-200 dark:border-gray-700"
                          }`}
                        >
                          <div className="font-medium text-sm text-gray-900 dark:text-white">
                            {sessionName}
                          </div>
                          {cs.club?.description && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                              {cs.club.description}
                            </p>
                          )}
                          {teacherName && (
                            <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                              {teacherName}
                            </div>
                          )}
                          <div className="flex items-center gap-3 mt-2 text-xs text-gray-500 dark:text-gray-400">
                            <span>
                              {cs._count.signups}/{capacity} enrolled
                            </span>
                            {spansRotations && (
                              <span className="text-indigo-600 dark:text-indigo-400 font-medium">
                                Spans {cs.rotations.map((r) => ROTATION_LABELS[r]).join(" + ")}
                              </span>
                            )}
                          </div>
                          <div className="mt-3">
                            <SignupButton
                              clubSessionId={cs.id}
                              signupId={signupId}
                              isMySignup={isMySignup}
                              isFull={isFull && !isMySignup}
                              isConflicted={
                                !isMySignup &&
                                cs.rotations.some((r) => bookedRotations.has(r))
                              }
                              conflictLabel={conflictLabel}
                              isPastDeadline={pastDeadline}
                              enrolledCount={cs._count.signups}
                              capacity={capacity}
                            />
                          </div>
                        </div>
                      );
                    })
                )}
              </div>
            </div>
          );
        })}
      </div>

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
