"use client";

import { useState, useEffect, useMemo } from "react";
import SignupButton from "@/components/signups/SignupButton";
import { ROTATION_LABELS, ALL_ROTATIONS } from "@/types";
import type { RotationSlot } from "@prisma/client";

export interface SessionViewData {
  id: string;
  sessionName: string;
  description: string | null;
  teacherName: string | null;
  rotations: RotationSlot[];
  enrolledCount: number;
  capacity: number;
  isMySignup: boolean;
  isForced: boolean;
  signupId: string | undefined;
  isFull: boolean;
  isConflicted: boolean;
  conflictLabel: string | undefined;
  spansRotations: boolean;
}

interface Props {
  sessions: SessionViewData[];
  deadlineISO: string;
  isPastDeadlineOnLoad: boolean;
  flexDayDateISO: string;
  flexDayLabel: string | null;
}

function formatCountdown(msRemaining: number): { text: string; urgency: "normal" | "warning" | "urgent" } {
  if (msRemaining <= 0) return { text: "Signups closed", urgency: "urgent" };

  const totalSeconds = Math.floor(msRemaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (totalSeconds < 300) {
    return {
      text: `Closes in ${minutes}m ${seconds}s`,
      urgency: "urgent",
    };
  }
  if (totalSeconds < 3600) {
    return {
      text: `Closes in ${minutes}m ${seconds}s`,
      urgency: "warning",
    };
  }
  if (totalSeconds < 86400) {
    return {
      text: `Closes in ${hours}h ${minutes}m`,
      urgency: "normal",
    };
  }
  return {
    text: `Closes in ${days}d ${hours}h`,
    urgency: "normal",
  };
}

export default function FlexDaySignupView({
  sessions,
  deadlineISO,
  isPastDeadlineOnLoad,
  flexDayDateISO,
  flexDayLabel,
}: Props) {
  const [isPastDeadline, setIsPastDeadline] = useState(isPastDeadlineOnLoad);
  const [countdown, setCountdown] = useState<{ text: string; urgency: "normal" | "warning" | "urgent" } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const deadline = new Date(deadlineISO);

    function tick() {
      const msRemaining = deadline.getTime() - Date.now();
      if (msRemaining <= 0) {
        setIsPastDeadline(true);
        setCountdown({ text: "Signups closed", urgency: "urgent" });
        clearInterval(id);
        return;
      }
      setCountdown(formatCountdown(msRemaining));
    }

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadlineISO]);

  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return sessions;
    const q = searchQuery.toLowerCase();
    return sessions.filter(
      (s) =>
        s.sessionName.toLowerCase().includes(q) ||
        s.description?.toLowerCase().includes(q) ||
        s.teacherName?.toLowerCase().includes(q)
    );
  }, [sessions, searchQuery]);

  const flexDayDate = new Date(flexDayDateISO);
  const formattedDate = flexDayDate.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

  const urgencyClass =
    isPastDeadline || countdown?.urgency === "urgent"
      ? "text-red-600 dark:text-red-400"
      : countdown?.urgency === "warning"
      ? "text-amber-600 dark:text-amber-400"
      : "text-indigo-600 dark:text-indigo-400";

  const isSearchActive = searchQuery.trim().length > 0;
  const totalSessions = sessions.length;
  const filteredCount = filteredSessions.length;

  return (
    <>
      {/* Flex day info box with countdown */}
      <div className="mb-6 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/50 p-5">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">
          {formattedDate}
        </h2>
        {flexDayLabel && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
            {flexDayLabel}
          </p>
        )}
        <div className={`text-xs font-medium mt-2 ${urgencyClass} ${countdown?.urgency === "urgent" && !isPastDeadline ? "font-bold" : ""}`}>
          {countdown ? countdown.text : isPastDeadline ? "Signups closed" : null}
        </div>
      </div>

      {/* Search input */}
      <div className="mb-4 flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-gray-500 pointer-events-none"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search clubs..."
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 pl-9 pr-8 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
          {isSearchActive && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
              aria-label="Clear search"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        {isSearchActive && (
          <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
            {filteredCount} of {totalSessions} {totalSessions === 1 ? "club" : "clubs"}
          </span>
        )}
      </div>

      {/* Rotation columns */}
      <div className="grid gap-6 lg:grid-cols-3">
        {ALL_ROTATIONS.map((slot) => {
          const columnSessions = filteredSessions.filter((s) => s.rotations.includes(slot));
          const allColumnSessions = sessions.filter((s) => s.rotations.includes(slot));
          const isBooked = allColumnSessions.some((s) => s.isMySignup);
          const hasSessionsInFull = allColumnSessions.length > 0;
          const hiddenBySearch = isSearchActive && columnSessions.length === 0 && hasSessionsInFull;

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
                {hiddenBySearch ? (
                  <div className="rounded-lg border border-dashed border-gray-200 dark:border-gray-700 p-4 text-center">
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      No clubs match your search.
                    </p>
                  </div>
                ) : columnSessions.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-gray-200 dark:border-gray-700 p-4 text-center">
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      No clubs scheduled for this rotation.
                    </p>
                    <p className="text-xs text-gray-300 dark:text-gray-600 mt-1">
                      Check the other rotations above.
                    </p>
                  </div>
                ) : (
                  columnSessions
                    .slice()
                    .sort((a, b) => (b.isMySignup ? 1 : 0) - (a.isMySignup ? 1 : 0))
                    .map((cs) => (
                      <div
                        key={cs.id}
                        className={`rounded-lg border p-3 ${
                          cs.isMySignup
                            ? "border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950/30"
                            : "border-gray-200 dark:border-gray-700"
                        }`}
                      >
                        <div className="font-medium text-sm text-gray-900 dark:text-white">
                          {cs.sessionName}
                        </div>
                        {cs.description && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                            {cs.description}
                          </p>
                        )}
                        {cs.teacherName && (
                          <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                            {cs.teacherName}
                          </div>
                        )}
                        <div className="flex items-center gap-3 mt-2 text-xs text-gray-500 dark:text-gray-400">
                          <span>
                            {cs.enrolledCount}/{cs.capacity} enrolled
                          </span>
                          {cs.spansRotations && (
                            <span className="text-indigo-600 dark:text-indigo-400 font-medium">
                              Spans {cs.rotations.map((r) => ROTATION_LABELS[r]).join(" + ")}
                            </span>
                          )}
                        </div>
                        <div className="mt-3">
                          <SignupButton
                            clubSessionId={cs.id}
                            signupId={cs.signupId}
                            isMySignup={cs.isMySignup}
                            isForced={cs.isForced}
                            isFull={cs.isFull && !cs.isMySignup}
                            isConflicted={cs.isConflicted}
                            conflictLabel={cs.conflictLabel}
                            isPastDeadline={isPastDeadline}
                            enrolledCount={cs.enrolledCount}
                            capacity={cs.capacity}
                          />
                        </div>
                      </div>
                    ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
