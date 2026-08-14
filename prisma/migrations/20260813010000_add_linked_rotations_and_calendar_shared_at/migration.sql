-- AlterTable: add linkedRotations flag and calendarSharedAt tracking to Club
ALTER TABLE "Club" ADD COLUMN "linkedRotations" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Club" ADD COLUMN "calendarSharedAt" TIMESTAMP(3);

-- Backfill: every existing club already had its calendar shared with its
-- teacher at creation time under the old (pre-finalize-gated) behavior, so
-- mark them as already shared to avoid re-sharing (and re-notifying) on the
-- next Flex Day finalized for them.
UPDATE "Club" SET "calendarSharedAt" = "createdAt" WHERE "googleCalendarId" IS NOT NULL;
