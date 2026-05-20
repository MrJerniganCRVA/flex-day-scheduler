-- AlterTable: add defaultCoTeacherId and defaultLinked to Club
ALTER TABLE "Club" ADD COLUMN "defaultCoTeacherId" TEXT;
ALTER TABLE "Club" ADD COLUMN "defaultLinked" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "Club_defaultCoTeacherId_idx" ON "Club"("defaultCoTeacherId");

-- AddForeignKey
ALTER TABLE "Club" ADD CONSTRAINT "Club_defaultCoTeacherId_fkey" FOREIGN KEY ("defaultCoTeacherId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
