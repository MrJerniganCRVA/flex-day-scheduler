-- CreateTable: a teacher out for a whole Flex block (or, as one row per
-- rotation, the whole day). Person-level, unlike SessionTeacherAbsence, which
-- records "not at this club" — see the model comment in schema.prisma.
CREATE TABLE "TeacherFlexAbsence" (
    "id" TEXT NOT NULL,
    "flexDayId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "rotation" "RotationSlot" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeacherFlexAbsence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TeacherFlexAbsence_flexDayId_teacherId_rotation_key" ON "TeacherFlexAbsence"("flexDayId", "teacherId", "rotation");

-- CreateIndex
CREATE INDEX "TeacherFlexAbsence_flexDayId_idx" ON "TeacherFlexAbsence"("flexDayId");

-- CreateIndex
CREATE INDEX "TeacherFlexAbsence_teacherId_idx" ON "TeacherFlexAbsence"("teacherId");

-- AddForeignKey
ALTER TABLE "TeacherFlexAbsence" ADD CONSTRAINT "TeacherFlexAbsence_flexDayId_fkey" FOREIGN KEY ("flexDayId") REFERENCES "FlexDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherFlexAbsence" ADD CONSTRAINT "TeacherFlexAbsence_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
