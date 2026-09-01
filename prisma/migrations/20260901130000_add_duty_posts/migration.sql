-- ─── Duty posts: non-club supervision ───────────────────────────────────────
--
-- Somewhere a teacher has to stand so the building has adequate eyes: a hallway,
-- the cafeteria, the front doors. Until now the Coverage page only knew about
-- clubs, so that staffing was invisible and a teacher on duty in Flex 1 did not
-- register as unavailable anywhere.
--
-- Two new tables and nothing else. No existing table is altered: everything
-- student-facing reaches sessions through ClubSession, so keeping duty out of
-- that table is what makes it invisible to the student pages, signups, the roster
-- CSV export, auto-assign and calendar finalize without touching any of them.
-- Modelling duty as a club with a flag would have needed a correct exclusion in
-- every one of those queries, and the first one missed would have offered a
-- hallway to students to sign up for — or auto-assigned a student into it, since
-- Club."allowRandomAssignment" defaults to true.

-- CreateTable
CREATE TABLE "DutyPost" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    -- The standing requirement, read live — not a default copied onto each day.
    -- It is what lets an unstaffed cafeteria show as a gap on its own, and keeps
    -- "nobody needed here in Flex 2" distinct from "nobody assigned yet".
    "requiredRotations" "RotationSlot"[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DutyPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DutyAssignment" (
    "id" TEXT NOT NULL,
    "dutyPostId" TEXT NOT NULL,
    "flexDayId" TEXT NOT NULL,
    "rotation" "RotationSlot" NOT NULL,
    -- Nullable and unambiguous: a duty post has no owner or cosponsor to fall
    -- back to, so NULL simply means unstaffed. No "cleared" flag is needed here,
    -- unlike SessionRotationCoverage where the fallback made a null ambiguous.
    "teacherId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DutyAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DutyPost_name_key" ON "DutyPost"("name");

-- CreateIndex: one assignment per post per rotation per day — the key the
-- assignment endpoint upserts against.
CREATE UNIQUE INDEX "DutyAssignment_dutyPostId_flexDayId_rotation_key"
  ON "DutyAssignment"("dutyPostId", "flexDayId", "rotation");

-- CreateIndex
CREATE INDEX "DutyAssignment_flexDayId_idx" ON "DutyAssignment"("flexDayId");

-- CreateIndex
CREATE INDEX "DutyAssignment_teacherId_idx" ON "DutyAssignment"("teacherId");

-- AddForeignKey
ALTER TABLE "DutyAssignment" ADD CONSTRAINT "DutyAssignment_dutyPostId_fkey"
  FOREIGN KEY ("dutyPostId") REFERENCES "DutyPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DutyAssignment" ADD CONSTRAINT "DutyAssignment_flexDayId_fkey"
  FOREIGN KEY ("flexDayId") REFERENCES "FlexDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: SET NULL, not CASCADE. Deleting a teacher must leave the post
-- visibly unstaffed rather than silently dropping the requirement to staff it.
ALTER TABLE "DutyAssignment" ADD CONSTRAINT "DutyAssignment_teacherId_fkey"
  FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
