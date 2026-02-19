"use client";

import { useSession, signOut } from "next-auth/react";
import Link from "next/link";
import Image from "next/image";

export default function Navbar() {
  const { data: session } = useSession();

  return (
    <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-6 py-3 flex items-center justify-between">
      <Link href="/" className="font-bold text-lg text-indigo-700 dark:text-indigo-400">
        Flex Day Scheduler
      </Link>

      <div className="flex items-center gap-4">
        {session?.user && (
          <>
            <span className="hidden sm:block text-sm text-gray-600 dark:text-gray-300">
              {session.user.name}
            </span>
            {session.user.image && (
              <Image
                src={session.user.image}
                alt={session.user.name ?? "User"}
                width={32}
                height={32}
                className="rounded-full"
              />
            )}
            <span className="text-xs bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 rounded-full font-medium capitalize">
              {session.user.role?.toLowerCase()}
            </span>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 transition-colors"
            >
              Sign out
            </button>
          </>
        )}
      </div>
    </header>
  );
}
