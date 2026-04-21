-- AlterTable: make clubId nullable and add new fields
ALTER TABLE "ClubSession" ALTER COLUMN "clubId" DROP NOT NULL;
ALTER TABLE "ClubSession" ADD COLUMN "title" TEXT;
ALTER TABLE "ClubSession" ADD COLUMN "capacityOverride" INTEGER;
ALTER TABLE "ClubSession" ADD COLUMN "teacherAbsent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ClubSession" ADD COLUMN "oneOffOwnerId" TEXT;

-- AddForeignKey
ALTER TABLE "ClubSession" ADD CONSTRAINT "ClubSession_oneOffOwnerId_fkey"
  FOREIGN KEY ("oneOffOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "ClubSession_oneOffOwnerId_idx" ON "ClubSession"("oneOffOwnerId");
