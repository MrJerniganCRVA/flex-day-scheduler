import SessionCard from "@/components/sessions/SessionCard";
import type { RotationSlot } from "@/types";

interface Signup {
  id: string;
  student: { id: string; name: string; email: string };
}

interface SiblingSession {
  id: string;
  rotations: RotationSlot[];
}

export interface FlexDaySessionData {
  sessionId: string;
  flexDayId: string;
  flexDayDate: string;
  flexDayLabel: string | null;
  rotations: RotationSlot[];
  enrollmentCount: number;
  maxCapacity: number;
  capacityOverride?: number | null;
  teacherAbsent?: boolean;
  roomOverrideId?: string | null;
  defaultRoomName?: string | null;
  signups: Signup[];
  siblingSessionOptions: SiblingSession[];
}

interface Props {
  clubId: string;
  sessions: FlexDaySessionData[];
}

/**
 * One visual box per Flex Day: the date/label header renders once, and each
 * session on that day (one for a linked club, one per rotation for an
 * unlinked club) renders as its own independently editable sub-section.
 */
export default function FlexDaySessionGroup({ clubId, sessions }: Props) {
  if (sessions.length === 0) return null;
  const first = sessions[0];

  const dateLabel = new Date(first.flexDayDate).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

  return (
    <div className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-5">
      <div className="mb-1">
        <span className="font-semibold text-gray-900 dark:text-white">{dateLabel}</span>
        {first.flexDayLabel && (
          <div className="text-xs text-gray-400 dark:text-gray-500">{first.flexDayLabel}</div>
        )}
      </div>
      <div>
        {sessions.map((s) => (
          <SessionCard
            key={s.sessionId}
            clubId={clubId}
            sessionId={s.sessionId}
            flexDayId={s.flexDayId}
            flexDayDate={s.flexDayDate}
            flexDayLabel={s.flexDayLabel}
            rotations={s.rotations}
            enrollmentCount={s.enrollmentCount}
            maxCapacity={s.maxCapacity}
            capacityOverride={s.capacityOverride}
            teacherAbsent={s.teacherAbsent}
            roomOverrideId={s.roomOverrideId}
            defaultRoomName={s.defaultRoomName}
            signups={s.signups}
            siblingSessionOptions={s.siblingSessionOptions}
            showDayHeader={false}
            bare
          />
        ))}
      </div>
    </div>
  );
}
