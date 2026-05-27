-- AlterTable: add teacherReassigned to ClubSession
ALTER TABLE "ClubSession" ADD COLUMN "teacherReassigned" BOOLEAN NOT NULL DEFAULT false;
