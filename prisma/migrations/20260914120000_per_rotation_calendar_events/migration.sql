-- ─── Per-rotation calendar events, created as the covering teacher ───────────
--
-- Two changes that have to land together, because they touch the same column.
--
-- 1. Invites are now created by a real user over OAuth rather than by the
--    service account. Google refuses `events.insert` with a non-empty attendee
--    list from an unimpersonated service account ("Service accounts cannot
--    invite attendees without Domain-Wide Delegation of Authority"), which is
--    why the first real finalize sent nothing to anybody. This Workspace does
--    not grant Domain-Wide Delegation, so CalendarGrant stores each teacher's
--    own consent instead.
--
-- 2. A session now emits one event per rotation instead of one event spanning
--    the earliest start to the latest end. The old span swallowed the transition
--    gaps between blocks, and made a linked session's single guest list the
--    union of every rotation's coverage — so a teacher covering Flex 1 and
--    Flex 3 was booked through Flex 2 as well, even when an admin had marked
--    them absent from it.
--
-- ClubSession."googleEventId" is dropped rather than migrated: no event was ever
-- successfully created, so every value in it is NULL.

-- CreateTable
CREATE TABLE "SessionCalendarEvent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "rotation" "RotationSlot" NOT NULL,
    "googleEventId" TEXT NOT NULL,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionCalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- One event per block. Also what stops a session merge from leaving two events
-- for the same rotation.
CREATE UNIQUE INDEX "SessionCalendarEvent_sessionId_rotation_key" ON "SessionCalendarEvent"("sessionId", "rotation");

-- CreateIndex
CREATE INDEX "SessionCalendarEvent_sessionId_idx" ON "SessionCalendarEvent"("sessionId");

-- CreateIndex
CREATE INDEX "SessionCalendarEvent_ownerId_idx" ON "SessionCalendarEvent"("ownerId");

-- AddForeignKey
ALTER TABLE "SessionCalendarEvent" ADD CONSTRAINT "SessionCalendarEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ClubSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- SetNull, not Cascade: losing the owning user must not delete the record of an
-- event that still exists in Google. That would strand it on a calendar with
-- nothing left pointing at it.
ALTER TABLE "SessionCalendarEvent" ADD CONSTRAINT "SessionCalendarEvent_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "CalendarGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "accessToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CalendarGrant_userId_key" ON "CalendarGrant"("userId");

-- AddForeignKey
-- Cascade: a deleted user's consent is meaningless, and the token it holds
-- should not outlive the account it was issued for.
ALTER TABLE "CalendarGrant" ADD CONSTRAINT "CalendarGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
-- Safe to drop outright: every value is NULL, because no event was ever created.
ALTER TABLE "ClubSession" DROP COLUMN "googleEventId";
