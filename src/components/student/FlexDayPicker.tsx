import Link from "next/link";

export interface FlexDayOption {
  id: string;
  date: Date;
  label: string | null;
}

/**
 * Switcher across every upcoming Flex Day.
 *
 * Without it a student could only ever reach the single nearest Flex Day: the
 * dashboard rendered that one day and nothing in the app linked to the per-day
 * page. Once the nearest day's Friday deadline passed, that left a closed
 * screen and no way through to the next day, whose signups were open.
 *
 * The nearest day links to /student rather than to its own page so the
 * dashboard stays the canonical landing spot for the common case.
 */
export default function FlexDayPicker({
  days,
  currentId,
}: {
  days: FlexDayOption[];
  currentId: string;
}) {
  if (days.length < 2) return null;

  return (
    <nav aria-label="Choose a Flex Day" className="mb-4">
      <div className="flex flex-wrap gap-2">
        {days.map((day, index) => {
          const isCurrent = day.id === currentId;
          const formatted = day.date.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            timeZone: "UTC",
          });

          return (
            <Link
              key={day.id}
              href={index === 0 ? "/student" : `/student/flex-days/${day.id}`}
              aria-current={isCurrent ? "page" : undefined}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                isCurrent
                  ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300"
                  : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
              }`}
            >
              {formatted}
              {day.label && (
                <span className="ml-1.5 text-gray-400 dark:text-gray-500">
                  {day.label}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
