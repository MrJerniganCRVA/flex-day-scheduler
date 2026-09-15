-- ─── Calendar events for duty posts ─────────────────────────────────────────
--
-- Finalizing a Flex Day sent invites for club sessions and nothing else, so a
-- teacher assigned to the cafeteria or the front doors received no calendar
-- entry at all. DutyPost was deliberately kept out of everything that reaches
-- students through `flexDay.clubSessions`, and calendar finalize was one of the
-- paths it was kept out of; this gives duty its own event record instead of
-- folding it into ClubSession.
--
-- Keyed on the assignment, not on [dutyPostId, flexDayId, rotation], even though
-- DutyAssignment already carries that unique triple. Assignments are upserted
-- rather than deleted when the covering teacher changes, so keying on the
-- assignment keeps this row alive across a reassignment — which is precisely
-- when it is needed, to withdraw the previous teacher's event before issuing the
-- new one.

-- CreateTable
CREATE TABLE "DutyCalendarEvent" (
    "id" TEXT NOT NULL,
    "dutyAssignmentId" TEXT NOT NULL,
    "googleEventId" TEXT NOT NULL,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DutyCalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- One event per staffed block, and what makes the upsert on re-runs idempotent.
CREATE UNIQUE INDEX "DutyCalendarEvent_dutyAssignmentId_key" ON "DutyCalendarEvent"("dutyAssignmentId");

-- CreateIndex
CREATE INDEX "DutyCalendarEvent_ownerId_idx" ON "DutyCalendarEvent"("ownerId");

-- AddForeignKey
-- Cascade: an assignment that no longer exists has no block to describe. Callers
-- that delete one must read its event first and withdraw it, the same ordering
-- src/lib/session-calendar.ts documents for sessions.
ALTER TABLE "DutyCalendarEvent" ADD CONSTRAINT "DutyCalendarEvent_dutyAssignmentId_fkey" FOREIGN KEY ("dutyAssignmentId") REFERENCES "DutyAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- SetNull, as on SessionCalendarEvent: losing the owning user must not delete
-- the record of an event that still exists in Google.
ALTER TABLE "DutyCalendarEvent" ADD CONSTRAINT "DutyCalendarEvent_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
