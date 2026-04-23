-- AlterTable: add allowRandomAssignment flag to Club
ALTER TABLE "Club" ADD COLUMN "allowRandomAssignment" BOOLEAN NOT NULL DEFAULT true;
