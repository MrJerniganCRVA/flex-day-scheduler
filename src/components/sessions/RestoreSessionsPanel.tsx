import AddSessionInline from "@/components/sessions/AddSessionInline";
import type { MissingFlexDay } from "@/lib/missing-sessions";

interface Props {
  clubId: string;
  linkedRotations: boolean;
  missingFlexDays: MissingFlexDay[];
}

/**
 * The way back from "Remove from Day". Rarely needed, so it stays collapsed at
 * the bottom of the club page and renders nothing when no day is missing.
 */
export default function RestoreSessionsPanel({
  clubId,
  linkedRotations,
  missingFlexDays,
}: Props) {
  if (missingFlexDays.length === 0) return null;

  return (
    <details className="mt-6 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
      <summary className="cursor-pointer text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
        Missing a Flex Day? Add a session back ({missingFlexDays.length})
      </summary>
      <p className="mt-2 mb-3 text-xs text-gray-500 dark:text-gray-400">
        Upcoming days where this club was removed, or is missing a rotation.
        Finalized days aren&apos;t listed. Ask an admin to unfinalize one first.
      </p>
      <AddSessionInline
        clubId={clubId}
        linkedRotations={linkedRotations}
        flexDays={missingFlexDays.map((fd) => ({
          id: fd.id,
          date: fd.date.toISOString(),
          label: fd.label,
          missingRotations: fd.missingRotations,
        }))}
      />
    </details>
  );
}
