-- AlterTable: add adminLocked to SessionRotationCoverage
ALTER TABLE "SessionRotationCoverage" ADD COLUMN "adminLocked" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable: DutyStation
CREATE TABLE "DutyStation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "maxTeachers" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DutyStation_pkey" PRIMARY KEY ("id")
);

-- CreateTable: DutyStationAssignment
CREATE TABLE "DutyStationAssignment" (
    "id" TEXT NOT NULL,
    "dutyStationId" TEXT NOT NULL,
    "flexDayId" TEXT NOT NULL,
    "rotation" "RotationSlot" NOT NULL,
    "teacherId" TEXT NOT NULL,
    "adminLocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DutyStationAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DutyStation_name_idx" ON "DutyStation"("name");

-- CreateIndex
CREATE INDEX "DutyStationAssignment_dutyStationId_idx" ON "DutyStationAssignment"("dutyStationId");

-- CreateIndex
CREATE INDEX "DutyStationAssignment_flexDayId_idx" ON "DutyStationAssignment"("flexDayId");

-- CreateIndex
CREATE INDEX "DutyStationAssignment_teacherId_idx" ON "DutyStationAssignment"("teacherId");

-- CreateIndex
CREATE UNIQUE INDEX "DutyStationAssignment_dutyStationId_flexDayId_rotation_teacherId_key" ON "DutyStationAssignment"("dutyStationId", "flexDayId", "rotation", "teacherId");

-- AddForeignKey
ALTER TABLE "DutyStationAssignment" ADD CONSTRAINT "DutyStationAssignment_dutyStationId_fkey" FOREIGN KEY ("dutyStationId") REFERENCES "DutyStation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DutyStationAssignment" ADD CONSTRAINT "DutyStationAssignment_flexDayId_fkey" FOREIGN KEY ("flexDayId") REFERENCES "FlexDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DutyStationAssignment" ADD CONSTRAINT "DutyStationAssignment_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
