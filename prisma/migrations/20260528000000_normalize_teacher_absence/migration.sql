-- CreateEnum
CREATE TYPE "AbsenceType" AS ENUM ('ABSENT', 'REASSIGNED');

-- CreateTable
CREATE TABLE "SessionRotationAbsence" (
  "id"        TEXT           NOT NULL,
  "sessionId" TEXT           NOT NULL,
  "rotation"  "RotationSlot" NOT NULL,
  "type"      "AbsenceType"  NOT NULL,
  CONSTRAINT "SessionRotationAbsence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SessionRotationAbsence_sessionId_rotation_key"
  ON "SessionRotationAbsence"("sessionId", "rotation");

-- CreateIndex
CREATE INDEX "SessionRotationAbsence_sessionId_idx"
  ON "SessionRotationAbsence"("sessionId");

-- AddForeignKey
ALTER TABLE "SessionRotationAbsence"
  ADD CONSTRAINT "SessionRotationAbsence_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "ClubSession"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: sessions with teacherAbsent = true → ABSENT for all their rotations
INSERT INTO "SessionRotationAbsence" ("id", "sessionId", "rotation", "type")
  SELECT gen_random_uuid()::text, cs."id", unnest(cs."rotations"), 'ABSENT'::"AbsenceType"
  FROM "ClubSession" cs
  WHERE cs."teacherAbsent" = true;

-- Backfill: sessions with teacherReassigned = true → REASSIGNED for all their rotations
-- ON CONFLICT DO NOTHING handles the edge case where both flags were somehow both true
INSERT INTO "SessionRotationAbsence" ("id", "sessionId", "rotation", "type")
  SELECT gen_random_uuid()::text, cs."id", unnest(cs."rotations"), 'REASSIGNED'::"AbsenceType"
  FROM "ClubSession" cs
  WHERE cs."teacherReassigned" = true
  ON CONFLICT ("sessionId", "rotation") DO NOTHING;

-- DropColumn
ALTER TABLE "ClubSession"
  DROP COLUMN "teacherAbsent",
  DROP COLUMN "teacherReassigned";
