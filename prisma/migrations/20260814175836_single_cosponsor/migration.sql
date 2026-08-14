/*
  Warnings:

  - You are about to drop the `_ClubCosponsor` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "_ClubCosponsor" DROP CONSTRAINT "_ClubCosponsor_A_fkey";

-- DropForeignKey
ALTER TABLE "_ClubCosponsor" DROP CONSTRAINT "_ClubCosponsor_B_fkey";

-- AlterTable
ALTER TABLE "Club" ADD COLUMN     "cosponsorId" TEXT;

-- DropTable
DROP TABLE "_ClubCosponsor";

-- CreateIndex
CREATE INDEX "Club_cosponsorId_idx" ON "Club"("cosponsorId");

-- AddForeignKey
ALTER TABLE "Club" ADD CONSTRAINT "Club_cosponsorId_fkey" FOREIGN KEY ("cosponsorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
