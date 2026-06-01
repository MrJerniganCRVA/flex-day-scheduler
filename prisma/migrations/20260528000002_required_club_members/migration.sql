-- Create ClubMember table
CREATE TABLE "ClubMember" (
  "id"        TEXT         NOT NULL,
  "clubId"    TEXT         NOT NULL,
  "studentId" TEXT         NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClubMember_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ClubMember_clubId_fkey"
    FOREIGN KEY ("clubId") REFERENCES "Club"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ClubMember_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ClubMember_clubId_studentId_key"
  ON "ClubMember"("clubId", "studentId");
CREATE INDEX "ClubMember_clubId_idx"    ON "ClubMember"("clubId");
CREATE INDEX "ClubMember_studentId_idx" ON "ClubMember"("studentId");

-- Add forced flag to Signup
ALTER TABLE "Signup" ADD COLUMN "forced" BOOLEAN NOT NULL DEFAULT false;
