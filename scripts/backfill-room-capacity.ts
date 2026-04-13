import prisma from '../src/lib/prisma';

async function backfillRoomCapacity() {
  console.log('🔍 Finding rooms without capacity...\n');

  const rooms = await prisma.room.findMany({
    where: { capacity: null },
    include: {
      clubsWithDefault: { select: { maxCapacity: true } },
      _count: {
        select: {
          clubsWithDefault: true,
          sessionOverrides: true,
        }
      }
    }
  });

  if (rooms.length === 0) {
    console.log('✅ All rooms already have capacity values!\n');
    return;
  }

  console.log(`Found ${rooms.length} room(s) without capacity:\n`);

  for (const room of rooms) {
    // Use the maximum capacity of clubs using this room, or default to 30
    const capacity = room.clubsWithDefault.length > 0
      ? Math.max(...room.clubsWithDefault.map(c => c.maxCapacity))
      : 30;

    await prisma.room.update({
      where: { id: room.id },
      data: { capacity }
    });

    const source = room.clubsWithDefault.length > 0
      ? `from ${room.clubsWithDefault.length} club(s)`
      : 'default value';

    console.log(`  ✓ ${room.name.padEnd(30)} → ${capacity.toString().padStart(3)} (${source})`);
  }

  console.log(`\n✅ Successfully backfilled ${rooms.length} room(s)\n`);
}

backfillRoomCapacity()
  .catch((error) => {
    console.error('❌ Error during backfill:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
