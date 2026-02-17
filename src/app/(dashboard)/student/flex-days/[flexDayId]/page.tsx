import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import { ROTATION_LABELS, ALL_ROTATIONS } from "@/types";
import SignupButton from "@/components/signups/SignupButton";
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
              location: true,
              owner: { select: { name: true } },
            },
          },
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

  // Build a map from rotation → sessions that include that rotation
  const rotationMap = new Map<RotationSlot, typeof flexDay.clubSessions>();
  for (const slot of ALL_ROTATIONS) {
    rotationMap.set(
      slot,
      flexDay.clubSessions.filter((s) => s.rotations.includes(slot))
    );
  }

  // Find which rotations the student has already booked
  const bookedRotations = new Set<RotationSlot>();
  for (const cs of flexDay.clubSessions) {
    if (cs.signups.length > 0) {
      for (const r of cs.rotations) bookedRotations.add(r);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">
        {flexDay.label ??
          new Date(flexDay.date).toLocaleDateString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
            timeZone: "UTC",
          })}
      </h1>
      <p className="text-gray-500 text-sm mb-6">
        Select a club for each rotation below.
      </p>

      <div className="grid gap-6 lg:grid-cols-3">
        {ALL_ROTATIONS.map((slot) => {
          const sessions = rotationMap.get(slot) ?? [];
          const isBooked = bookedRotations.has(slot);

          return (
            <div key={slot} className="rounded-xl bg-white border border-gray-200 overflow-hidden">
              <div
                className={`px-5 py-3 font-semibold text-sm ${
                  isBooked
                    ? "bg-green-50 text-green-700"
                    : "bg-indigo-50 text-indigo-700"
                }`}
              >
                {ROTATION_LABELS[slot]}
                {isBooked && <span className="ml-2 text-xs">(Booked)</span>}
              </div>
              <div className="p-4 space-y-3">
                {sessions.length === 0 ? (
                  <p className="text-sm text-gray-400 italic">
                    No clubs scheduled for this rotation.
                  </p>
                ) : (
                  sessions.map((cs) => {
                    const isFull = cs._count.signups >= cs.club.maxCapacity;
                    const isMySignup = cs.signups.length > 0;
                    const signupId = cs.signups[0]?.id;
                    // Check if this session spans multiple rotations
                    const spansRotations = cs.rotations.length > 1;
                    const otherRotations = cs.rotations.filter((r) => r !== slot);

                    return (
                      <div
                        key={cs.id}
                        className={`rounded-lg border p-3 ${
                          isMySignup
                            ? "border-green-300 bg-green-50"
                            : "border-gray-200"
                        }`}
                      >
                        <div className="font-medium text-sm text-gray-900">
                          {cs.club.name}
                        </div>
                        {cs.club.description && (
                          <p className="text-xs text-gray-500 mt-0.5">
                            {cs.club.description}
                          </p>
                        )}
                        <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                          {cs.club.location && <span>📍 {cs.club.location}</span>}
                          <span>
                            {cs._count.signups}/{cs.club.maxCapacity} enrolled
                          </span>
                          {spansRotations && (
                            <span className="text-indigo-600 font-medium">
                              Also: {otherRotations
                                .map((r) => ROTATION_LABELS[r])
                                .join(", ")}
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
    </div>
  );
}
