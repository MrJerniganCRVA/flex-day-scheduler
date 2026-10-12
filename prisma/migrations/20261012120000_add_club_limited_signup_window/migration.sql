-- AlterTable: add limitedSignupWindow flag to Club
ALTER TABLE "Club" ADD COLUMN "limitedSignupWindow" BOOLEAN NOT NULL DEFAULT false;
