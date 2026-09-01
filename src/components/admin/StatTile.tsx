/**
 * One number with a label and a hint, for the summary row at the top of an admin
 * screen.
 *
 * Extracted from the admin dashboard, where it started, once the Coverage page
 * needed the same thing. There was already a second, divergent `StatTile` inside
 * AutoAssignTab (borderless, tinted background) — a third copy is how that happens
 * again, so this is the shared one. AutoAssignTab's is deliberately left alone:
 * it is a genuinely different treatment for a different context, and merging them
 * would mean a variant prop earning its keep across two call sites.
 *
 * On `tone`: pass `neutral` when the count is zero, even for a tile that is
 * otherwise `bad`. Nothing in this app renders a zero in red — a screen scanned
 * for problems should show colour only where there is one.
 */
export default function StatTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint: string;
  tone: "good" | "warn" | "bad" | "neutral";
}) {
  const toneClass = {
    good: "text-green-700 dark:text-green-400",
    warn: "text-amber-700 dark:text-amber-400",
    bad: "text-red-600 dark:text-red-400",
    neutral: "text-gray-700 dark:text-gray-200",
  }[tone];

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2">
      <div className={`text-xl font-bold ${toneClass}`}>{value}</div>
      <div className="text-xs font-medium text-gray-600 dark:text-gray-300">
        {label}
      </div>
      <div className="text-[11px] text-gray-400 dark:text-gray-500">{hint}</div>
    </div>
  );
}
