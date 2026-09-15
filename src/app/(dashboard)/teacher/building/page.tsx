import { auth } from "@/auth";
import { redirect } from "next/navigation";
import BuildingBoard from "@/components/dashboard/BuildingBoard";
import { loadFlexDayBoard } from "@/lib/flex-day-board";

/**
 * The next Flex Day across the whole building, for anyone on staff.
 *
 * The teacher dashboard answers "where am *I* meant to be", which is the wrong
 * question for the people who asked for this page: support staff run no clubs,
 * so their dashboard is empty, and they are not admins, so the Coverage page
 * that holds this information is closed to them. They need to know what is
 * happening in each part of the building — which is the same grid with the
 * dropdowns taken out.
 *
 * Open to every teacher rather than gated behind a new role. Roles here are
 * derived from the email domain (src/auth.ts), so support staff already hold
 * TEACHER; and a teacher knowing which colleague is in which room is not
 * privileged information — several of them are on that grid already, because
 * coverage puts them there.
 */
export default async function BuildingPage() {
  // src/proxy.ts already bounces anyone below TEACHER away from /teacher/*, so
  // this is only about having a user to be — every page under this tree
  // re-checks, and a reader would wonder at its absence.
  const session = await auth();
  if (!session?.user) redirect("/login");

  const board = await loadFlexDayBoard();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Who&apos;s Where
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {board
            ? board.flexDayLabel
            : "Every club, room and duty post on the next Flex Day."}
        </p>
      </div>

      {board ? (
        <BuildingBoard
          sessions={board.sessions}
          duties={board.duties}
          staff={board.staff}
        />
      ) : (
        // Same wording as the teacher dashboard's empty state — it is the same
        // fact, and two phrasings of it read as two different conditions.
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 p-10 text-center text-gray-400 dark:text-gray-500">
          No upcoming Flex Days scheduled yet.
        </div>
      )}
    </div>
  );
}
