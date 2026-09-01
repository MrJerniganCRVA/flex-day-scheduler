import { auth } from "@/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import DutyPostManager from "@/components/admin/DutyPostManager";

/**
 * Where the supervision spots that are not clubs get defined.
 *
 * Separate from the Coverage page on purpose: defining a post is something you do
 * once and rarely change, while assigning someone to it happens every Flex Day.
 * That is the same split the app already makes for Clubs and Rooms, and it keeps
 * CRUD off the Coverage page, which is the densest screen in the app.
 */
export default async function AdminDutyPostsPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/unauthorized");

  const dutyPosts = await prisma.dutyPost.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    include: { _count: { select: { assignments: true } } },
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Duty Posts
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Supervision spots that aren&apos;t clubs — hallways, the cafeteria, the
          front doors. Assign teachers to them on the Coverage page.
        </p>
      </div>

      <DutyPostManager initialDutyPosts={dutyPosts} />
    </div>
  );
}
