-- Create TeacherFlexDayAbsence (teacher-level, not session-level)
CREATE TABLE "TeacherFlexDayAbsence" (
  "id"        TEXT           NOT NULL,
  "userId"    TEXT           NOT NULL,
  "flexDayId" TEXT           NOT NULL,
  "rotation"  "RotationSlot" NOT NULL,
  "type"      "AbsenceType"  NOT NULL,
  CONSTRAINT "TeacherFlexDayAbsence_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TeacherFlexDayAbsence_userId_flexDayId_rotation_key"
  ON "TeacherFlexDayAbsence"("userId", "flexDayId", "rotation");
CREATE INDEX "TeacherFlexDayAbsence_userId_idx"    ON "TeacherFlexDayAbsence"("userId");
CREATE INDEX "TeacherFlexDayAbsence_flexDayId_idx" ON "TeacherFlexDayAbsence"("flexDayId");
ALTER TABLE "TeacherFlexDayAbsence"
  ADD CONSTRAINT "TeacherFlexDayAbsence_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "TeacherFlexDayAbsence_flexDayId_fkey"
    FOREIGN KEY ("flexDayId") REFERENCES "FlexDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: promote session-level absences to teacher+flexDay level
INSERT INTO "TeacherFlexDayAbsence" ("id", "userId", "flexDayId", "rotation", "type")
SELECT gen_random_uuid()::text,
       COALESCE(c."ownerId", cs."oneOffOwnerId"),
       cs."flexDayId",
       sra."rotation",
       sra."type"
FROM "SessionRotationAbsence" sra
JOIN "ClubSession" cs ON cs."id" = sra."sessionId"
LEFT JOIN "Club" c ON c."id" = cs."clubId"
WHERE COALESCE(c."ownerId", cs."oneOffOwnerId") IS NOT NULL
ON CONFLICT ("userId", "flexDayId", "rotation") DO NOTHING;

DROP TABLE "SessionRotationAbsence";
