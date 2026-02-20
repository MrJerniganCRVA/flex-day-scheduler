"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";

type NavItem = { label: string; href: string; exact?: boolean };

const studentNav: NavItem[] = [
  { label: "Flex Days", href: "/student", exact: true },
  { label: "My Signups", href: "/student/my-signups" },
];

const teacherNav: NavItem[] = [
  { label: "Dashboard", href: "/teacher", exact: true },
  { label: "My Clubs", href: "/teacher/clubs" },
  { label: "Schedule Session", href: "/teacher/sessions/new" },
];

const adminNav: NavItem[] = [
  { label: "Dashboard", href: "/admin", exact: true },
  { label: "Flex Days", href: "/admin/flex-days" },
  { label: "Users", href: "/admin/users" },
  { label: "All Clubs", href: "/admin/clubs" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const role = session?.user?.role;
  const [teacherFullyBooked, setTeacherFullyBooked] = useState(false);

  useEffect(() => {
    if (role !== "TEACHER") return;
    fetch("/api/teacher/availability")
      .then((r) => r.json())
      .then((data) => setTeacherFullyBooked(data.fullyBooked ?? false))
      .catch(() => {});
  }, [role, pathname]);

  const baseItems =
    role === "ADMIN"
      ? adminNav
      : role === "TEACHER"
        ? teacherNav
        : studentNav;

  const items =
    role === "TEACHER" && teacherFullyBooked
      ? baseItems.filter((item) => item.href !== "/teacher/sessions/new")
      : baseItems;

  return (
    <aside className="w-56 shrink-0 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 min-h-screen pt-6">
      <nav className="px-3">
        <ul className="space-y-1">
          {items.map((item) => {
            const active =
              item.href === "/" || item.exact
                ? pathname === item.href
                : pathname.startsWith(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    active
                      ? "bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300"
                      : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white"
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
