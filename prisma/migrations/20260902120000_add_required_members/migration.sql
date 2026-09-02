-- ─── Required club members ──────────────────────────────────────────────────
--
-- Some club attendance is not a choice. Yearbook staff, club officers, a student
-- assigned to a club as an intervention — a teacher needs those students in the
-- room every Flex Day, and until now the only way to arrange that was to ask them
-- to sign themselves up and hope, or to have an admin hand-place them one session
-- at a time through the roster override.
--
-- RequiredMember is the standing statement of that: student X belongs to club Y
-- every time. Signup."forced" is what it produces — an ordinary signup, flagged,
-- so that every existing query (capacity counts, rotation-conflict checks,
-- auto-assign's coveredRotations, the roster CSV, calendar finalize) keeps
-- working on it untouched. A separate "forced signups" table would have needed
-- each of those to learn about a second source of enrollment.
--
-- Named RequiredMember, not ClubMember: ClubTeacher is already the teacher
-- rotation pool, and "member" beside it reads as "anyone in the club".

-- CreateTable
CREATE TABLE "RequiredMember" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequiredMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RequiredMember_clubId_studentId_key" ON "RequiredMember"("clubId", "studentId");

-- CreateIndex
CREATE INDEX "RequiredMember_clubId_idx" ON "RequiredMember"("clubId");

-- CreateIndex
CREATE INDEX "RequiredMember_studentId_idx" ON "RequiredMember"("studentId");

-- AddForeignKey
-- Cascade on both sides: a deleted club has no roster, and a deleted student is
-- not required anywhere. Neither leaves anything worth auditing behind — the
-- Signup rows it produced are what carry the history, and those cascade from
-- their own parents.
ALTER TABLE "RequiredMember" ADD CONSTRAINT "RequiredMember_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequiredMember" ADD CONSTRAINT "RequiredMember_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
-- Defaults false, so every signup that already exists stays the student's own to
-- cancel. Only the required-member path ever sets it true.
ALTER TABLE "Signup" ADD COLUMN "forced" BOOLEAN NOT NULL DEFAULT false;
