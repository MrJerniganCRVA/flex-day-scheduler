import Link from "next/link";

/**
 * Asks a teacher to connect their Google Calendar, once.
 *
 * Google will not let this app create events on anybody's calendar until that
 * person has allowed it, and the administrative shortcut for granting it on a
 * whole domain's behalf — Domain-Wide Delegation — is not available in this
 * Workspace. So the app asks each teacher directly. It is a single click and it
 * lasts until they revoke it.
 *
 * Deliberately prominent rather than tucked into a settings page: a teacher who
 * never notices this does not lose anything visible to them — their invites
 * quietly go out from an admin instead — so the cost of it being missable is
 * paid by somebody else.
 *
 * Never rendered for students. They are guests on an event, which asks nothing
 * of them.
 */
export type CalendarGrantState = "connected" | "missing" | "revoked";

export default function CalendarConnectBanner({
  state,
  justReturned,
}: {
  state: CalendarGrantState;
  /** The `?calendar=` flag the OAuth callback redirects back with, if any. */
  justReturned?: "connected" | "declined" | "failed";
}) {
  if (state === "connected") {
    if (justReturned !== "connected") return null;
    return (
      <div className="rounded-xl border border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/40 px-4 py-3">
        <p className="text-sm font-semibold text-green-800 dark:text-green-200">
          Google Calendar connected
        </p>
        <p className="mt-0.5 text-xs text-green-700 dark:text-green-300">
          Flex Day invites for the blocks you cover will now be sent from you.
        </p>
      </div>
    );
  }

  const revoked = state === "revoked";

  return (
    <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 p-4">
      <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
        {revoked
          ? "Reconnect your Google Calendar"
          : "Connect your Google Calendar"}
      </p>
      <p className="mt-1 text-xs text-amber-800 dark:text-amber-200">
        {revoked
          ? "Your Google account no longer lets this app create events for you, so your Flex Day invites are being sent from an admin instead."
          : "Flex Day invites for the blocks you cover should come from you, so students can see who is running the room and reply to the right person."}{" "}
        It takes one click and only needs doing once.
      </p>
      {justReturned === "failed" && (
        <p className="mt-2 text-xs font-medium text-red-700 dark:text-red-300">
          That didn&apos;t work. Try again, and if it keeps failing, ask an admin
          to check the app&apos;s Google configuration.
        </p>
      )}
      <Link
        href="/api/calendar/connect"
        prefetch={false}
        className="mt-3 inline-flex items-center rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 transition-colors"
      >
        {revoked ? "Reconnect Google Calendar" : "Connect Google Calendar"}
      </Link>
    </div>
  );
}
