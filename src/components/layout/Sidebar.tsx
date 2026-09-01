"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";

type NavItem = { label: string; href: string; exact?: boolean };

const studentNav: NavItem[] = [
  { label: "Flex Days", href: "/student", exact: true },
  { label: "Signups", href: "/student/my-signups" },
];

const teacherNav: NavItem[] = [
  { label: "Dashboard", href: "/teacher", exact: true },
  { label: "Clubs", href: "/teacher/clubs" },
  { label: "New Session", href: "/teacher/sessions/new" },
];

const adminNav: NavItem[] = [
  { label: "Dashboard", href: "/admin", exact: true },
  { label: "Flex Days", href: "/admin/flex-days" },
  { label: "Coverage", href: "/admin/coverage" },
  { label: "Rooms", href: "/admin/rooms" },
  { label: "Duty Posts", href: "/admin/duty-posts" },
  { label: "Users", href: "/admin/users" },
  { label: "Clubs", href: "/admin/clubs" },
  { label: "Student View", href: "/student", exact: true },
];

/** The nav items for the signed-in user, each marked active or not. */
function useNavLinks() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const role = session?.user?.role;

  const items =
    role === "ADMIN" ? adminNav : role === "TEACHER" ? teacherNav : studentNav;

  return items.map((item) => ({
    ...item,
    active:
      item.href === "/" || item.exact
        ? pathname === item.href
        : pathname.startsWith(item.href),
  }));
}

function linkClass(active: boolean): string {
  return `block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
    active
      ? "bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300"
      : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white"
  }`;
}

/**
 * Horizontal nav strip shown instead of the sidebar on narrow screens.
 *
 * The sidebar below is a fixed 224px column. At every width it took that 224px,
 * which on a 390px phone left roughly 120px of usable width beside it — and
 * students overwhelmingly use phones. This renders the same links as a
 * scrolling strip above the content, and the column is hidden.
 *
 * It lives above the sidebar/content row rather than inside it, which is why
 * it's a separate export rather than a fragment returned from `Sidebar`.
 */
export function MobileNav() {
  const links = useNavLinks();

  return (
    <nav
      aria-label="Main"
      className="md:hidden border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-x-auto"
    >
      <ul className="flex gap-1 px-3 py-2 whitespace-nowrap">
        {links.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={item.active ? "page" : undefined}
              className={linkClass(item.active)}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default function Sidebar() {
  const links = useNavLinks();

  return (
    <aside className="hidden md:block w-56 shrink-0 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 min-h-screen pt-6">
      <nav aria-label="Main" className="px-3">
        <ul className="space-y-1">
          {links.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={item.active ? "page" : undefined}
                className={linkClass(item.active)}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
