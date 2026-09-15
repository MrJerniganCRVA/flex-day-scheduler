import { auth } from "@/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import TabNav from "@/components/admin/TabNav";
import RoomManagementClient from "@/components/admin/RoomManagementClient";
import DutyPostManager from "@/components/admin/DutyPostManager";

/**
 * The two lists of physical things a Flex Day is built out of: the rooms clubs
 * meet in, and the supervision spots that aren't clubs.
 *
 * Tabs rather than two sidebar entries because both are set up once and then
 * rarely touched, and the admin nav had grown to nine items. Assigning someone
 * to a duty post still happens on the Coverage page every Flex Day — that split
 * is deliberate and unchanged, it just isn't worth a top-level slot each.
 */

const TABS = [
  { key: "rooms", label: "Rooms" },
  { key: "duty-posts", label: "Duty Posts" },
] as const;

const DESCRIPTIONS: Record<string, string> = {
  rooms: "Manage all rooms available for club sessions",
  "duty-posts":
    "Supervision spots that aren't clubs. Assign teachers to them on the Coverage page.",
};

export default async function AdminSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/unauthorized");

  // Validated rather than trusted, the way the Coverage page does it.
  const { tab: rawTab } = await searchParams;
  const tab = rawTab === "duty-posts" ? "duty-posts" : "rooms";

  // Only the visible tab's list is loaded.
  const rooms =
    tab === "rooms"
      ? await prisma.room.findMany({
          where: { isActive: true },
          orderBy: { name: "asc" },
          include: {
            _count: {
              select: {
                clubsWithDefault: true,
                sessionOverrides: true,
              },
            },
          },
        })
      : [];

  const dutyPosts =
    tab === "duty-posts"
      ? await prisma.dutyPost.findMany({
          orderBy: [{ isActive: "desc" }, { name: "asc" }],
          include: { _count: { select: { assignments: true } } },
        })
      : [];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Setup</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {DESCRIPTIONS[tab]}
        </p>
      </div>

      <TabNav tabs={TABS} active={tab} className="mb-6" />

      {tab === "rooms" ? (
        <RoomManagementClient initialRooms={rooms} />
      ) : (
        <DutyPostManager initialDutyPosts={dutyPosts} />
      )}
    </div>
  );
}
