"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";

type NavItem = { label: string; href: string };

const studentNav: NavItem[] = [
  { label: "Flex Days", href: "/student" },
  { label: "My Signups", href: "/student/my-signups" },
];

const teacherNav: NavItem[] = [
  { label: "Dashboard", href: "/teacher" },
  { label: "My Clubs", href: "/teacher/clubs" },
  { label: "Schedule Session", href: "/teacher/sessions/new" },
];

const adminNav: NavItem[] = [
  { label: "Dashboard", href: "/admin" },
  { label: "Flex Days", href: "/admin/flex-days" },
  { label: "Users", href: "/admin/users" },
  { label: "All Clubs", href: "/admin/clubs" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const role = session?.user?.role;

  const items =
    role === "ADMIN"
      ? adminNav
      : role === "TEACHER"
        ? teacherNav
        : studentNav;

  return (
    <aside className="w-56 shrink-0 bg-white border-r border-gray-200 min-h-screen pt-6">
      <nav className="px-3">
        <ul className="space-y-1">
          {items.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    active
                      ? "bg-indigo-50 text-indigo-700"
                      : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
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
