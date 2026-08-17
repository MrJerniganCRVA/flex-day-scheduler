-- ─── Club.ownerId becomes optional ──────────────────────────────────────────
-- A club may legitimately have no owner: some clubs are run by a rotation of
-- teachers with nobody permanently responsible. Ownership stays an
-- administrative role (who may edit the club); who is actually in the room is
-- answered per session by SessionRotationCoverage.
--
-- The foreign key stays ON DELETE RESTRICT. Deleting a teacher must still not
-- silently detach their clubs — an admin now has a way to comply by clearing
-- ownership rather than having to find a replacement.
ALTER TABLE "Club" ALTER COLUMN "ownerId" DROP NOT NULL;

-- CreateTable: the pool of teachers who rotate through a club. Distinct from
-- owner/cosponsor — membership here grants no permission to edit the club.
CREATE TABLE "ClubTeacher" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClubTeacher_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClubTeacher_clubId_teacherId_key" ON "ClubTeacher"("clubId", "teacherId");

-- CreateIndex
CREATE INDEX "ClubTeacher_clubId_idx" ON "ClubTeacher"("clubId");

-- CreateIndex
CREATE INDEX "ClubTeacher_teacherId_idx" ON "ClubTeacher"("teacherId");

-- AddForeignKey
ALTER TABLE "ClubTeacher" ADD CONSTRAINT "ClubTeacher_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubTeacher" ADD CONSTRAINT "ClubTeacher_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Per-teacher session absences ───────────────────────────────────────────
-- Replaces ClubSession.teacherAbsent, a single boolean that could not say which
-- teacher was out. Absence must be explicit rather than expressed by clearing a
-- coverage row, because the teacher is often the club's owner and therefore the
-- implicit default — removing the row would let the fallback re-add them.
CREATE TABLE "SessionTeacherAbsence" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "rotation" "RotationSlot" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionTeacherAbsence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: rotation is part of the key and NOT NULL on purpose. Postgres
-- treats NULLs as distinct in a unique index, so a nullable "all rotations"
-- value would permit duplicate rows for the same teacher and session.
CREATE UNIQUE INDEX "SessionTeacherAbsence_sessionId_teacherId_rotation_key" ON "SessionTeacherAbsence"("sessionId", "teacherId", "rotation");

-- CreateIndex
CREATE INDEX "SessionTeacherAbsence_sessionId_idx" ON "SessionTeacherAbsence"("sessionId");

-- CreateIndex
CREATE INDEX "SessionTeacherAbsence_teacherId_idx" ON "SessionTeacherAbsence"("teacherId");

-- AddForeignKey
ALTER TABLE "SessionTeacherAbsence" ADD CONSTRAINT "SessionTeacherAbsence_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ClubSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionTeacherAbsence" ADD CONSTRAINT "SessionTeacherAbsence_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every session previously flagged teacherAbsent becomes absence rows
-- for that club's owner, across each rotation the session covers. The owner is
-- the only teacher the old boolean could have meant — it was toggled from the
-- teacher's own club page, and the owner is the implicit primary. Sessions whose
-- club has no owner (or one-off sessions, which have no club) are skipped;
-- there is nobody to attribute the absence to.
INSERT INTO "SessionTeacherAbsence" ("id", "sessionId", "teacherId", "rotation", "reason", "createdAt")
SELECT
    gen_random_uuid()::text,
    cs."id",
    c."ownerId",
    rotation,
    'Migrated from the previous per-session absent flag',
    cs."updatedAt"
FROM "ClubSession" cs
JOIN "Club" c ON c."id" = cs."clubId"
CROSS JOIN LATERAL unnest(cs."rotations") AS rotation
WHERE cs."teacherAbsent" = true
  AND c."ownerId" IS NOT NULL
ON CONFLICT ("sessionId", "teacherId", "rotation") DO NOTHING;

-- AlterTable: drop the replaced flag now that its data has been migrated.
ALTER TABLE "ClubSession" DROP COLUMN "teacherAbsent";
