import Link from "next/link";

export type TabDef = {
  key: string;
  label: string;
  /** Count shown in a red pill beside the label. Hidden when 0 or undefined. */
  badge?: number;
};

/**
 * The tab strip used by the admin pages that split their content by `?tab=`.
 *
 * Extracted because there were three hand-copied versions of it — flex day
 * detail, users, coverage — and folding Rooms/Duty Posts and Users/Student
 * Signups into tabbed pages would have made five. None of the copies handled a
 * narrow screen: the tab row is a bare `flex`, so on a phone the labels squash
 * instead of scrolling, which is exactly what the main nav learned not to do
 * (see MobileNav in components/layout/Sidebar.tsx). This one scrolls.
 *
 * Links are relative (`?tab=…`), so they keep the path and drop every other
 * search param — the same behaviour the copies had. No page currently pairs a
 * tab with another param, but a page that wants to would need to build the href
 * itself.
 *
 * Deliberately has no "use client" and no server-only imports, so it renders
 * inside a server page or a client one (CoverageDashboard) without ceremony.
 */
export default function TabNav({
  tabs,
  active,
  right,
  className = "",
}: {
  tabs: readonly TabDef[];
  active: string;
  /** Trailing content in the same bordered row, e.g. a filter control. */
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex items-end justify-between gap-4 border-b border-gray-200 dark:border-gray-700 ${className}`}
    >
      <nav
        aria-label="Tabs"
        /* no-scrollbar: the strip is one row tall, so the gutter a classic
           scrollbar reserves is most of it. It still scrolls. */
        className="flex gap-1 overflow-x-auto whitespace-nowrap no-scrollbar"
      >
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`?tab=${t.key}`}
            aria-current={active === t.key ? "page" : undefined}
            className={
              active === t.key
                ? "flex shrink-0 items-center gap-1.5 px-4 py-3 text-sm font-medium text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400 -mb-px"
                : "flex shrink-0 items-center gap-1.5 px-4 py-3 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            }
          >
            {t.label}
            {t.badge !== undefined && t.badge > 0 && (
              <span className="rounded-full bg-red-100 dark:bg-red-900/40 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:text-red-300 tabular-nums">
                {t.badge}
              </span>
            )}
          </Link>
        ))}
      </nav>
      {right}
    </div>
  );
}
