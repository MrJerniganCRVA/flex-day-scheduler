import Link from "next/link";

/**
 * Which teachers on the upcoming Flex Day cannot yet send their own invites.
 *
 * The point of showing this here is timing. Without it the first an admin hears
 * of an unconnected teacher is the amber report *after* pressing Send Calendar
 * Invites — by which time those invites have already gone out from the admin
 * under their own name. On the Coverage page, where the same admin is already
 * deciding who runs what, there is still time to ask.
 *
 * Renders nothing when everyone is ready, so it is a warning rather than a
 * permanent fixture.
 */
export default function CalendarReadinessPanel({
  unconnected,
  adminConnected,
}: {
  unconnected: { id: string; name: string }[];
  /** Whether the signed-in admin can act as the backstop sender. */
  adminConnected: boolean;
}) {
  if (unconnected.length === 0 && adminConnected) return null;

  return (
    <div className="mb-4 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 p-4">
      {unconnected.length > 0 && (
        <>
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
            {unconnected.length} teacher{unconnected.length === 1 ? "" : "s"} on
            this Flex Day {unconnected.length === 1 ? "has" : "have"} not
            connected Google Calendar
          </p>
          <p className="mt-1 text-xs text-amber-800 dark:text-amber-200">
            Their blocks&apos; invites will be sent from{" "}
            {adminConnected ? "you" : "an admin"} instead of from them. Students
            still get invited either way — ask{" "}
            {unconnected.length === 1 ? "them" : "each of them"} to open the app
            and press Connect Google Calendar on their dashboard.
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {unconnected.map((t) => (
              <li
                key={t.id}
                className="rounded-md bg-amber-100 dark:bg-amber-900/50 px-2 py-0.5 text-xs text-amber-900 dark:text-amber-100"
              >
                {t.name}
              </li>
            ))}
          </ul>
        </>
      )}

      {!adminConnected && (
        <div className={unconnected.length > 0 ? "mt-3 border-t border-amber-300 dark:border-amber-700 pt-3" : ""}>
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
            You have not connected Google Calendar
          </p>
          <p className="mt-1 text-xs text-amber-800 dark:text-amber-200">
            An admin&apos;s calendar is what covers any block whose teacher
            cannot send their own invite. Without one connected, those blocks get
            no invites at all.
          </p>
          <Link
            href="/api/calendar/connect"
            prefetch={false}
            className="mt-2 inline-flex items-center rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 transition-colors"
          >
            Connect Google Calendar
          </Link>
        </div>
      )}
    </div>
  );
}
