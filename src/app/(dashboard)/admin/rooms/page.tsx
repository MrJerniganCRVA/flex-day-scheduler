import { auth } from "@/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import RoomManagementClient from "@/components/admin/RoomManagementClient";

export default async function AdminRoomsPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/unauthorized");

  const rooms = await prisma.room.findMany({
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
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Room Management
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Manage all rooms available for club sessions
        </p>
      </div>

      <RoomManagementClient initialRooms={rooms} />
    </div>
  );
}
