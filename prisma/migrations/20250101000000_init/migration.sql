-- Baseline migration backfilled after the fact: the schema's base tables were
-- historically created via `prisma db push`, never captured as a migration,
-- so `prisma migrate deploy` had nothing that could bootstrap a genuinely
-- empty database (every existing migration is an ALTER TABLE delta on top of
-- tables that were assumed to already exist).
--
-- This represents the schema as it stood immediately before the first
-- incremental migration (20260421000000_add_signup_attended) — the 4
-- existing migrations apply their deltas on top of this to reach the current
-- schema. Every statement is guarded (IF NOT EXISTS / duplicate_object) so
-- this is a safe no-op when run against a database that already has the
-- full, current schema (e.g. any environment that was already fully
-- migrated, or was set up via `db push`, before this migration existed).

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "Role" AS ENUM ('STUDENT', 'TEACHER', 'ADMIN');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "RotationSlot" AS ENUM ('FLEX_1', 'FLEX_2', 'FLEX_3');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "image" TEXT,
    "emailVerified" TIMESTAMP(3),
    "role" "Role" NOT NULL DEFAULT 'STUDENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "FlexDay" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "label" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isFinalized" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlexDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Room" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Club" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "maxCapacity" INTEGER NOT NULL,
    "defaultRoomId" TEXT,
    "defaultRotations" "RotationSlot"[],
    "googleCalendarId" TEXT,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Club_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ClubSession" (
    "id" TEXT NOT NULL,
    "flexDayId" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "rotations" "RotationSlot"[],
    "roomOverrideId" TEXT,
    "googleEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClubSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SessionRotationCoverage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "rotation" "RotationSlot" NOT NULL,
    "primaryTeacherId" TEXT,
    "secondaryTeacherId" TEXT,

    CONSTRAINT "SessionRotationCoverage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Signup" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "clubSessionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Signup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FlexDay_date_idx" ON "FlexDay"("date");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "FlexDay_date_key" ON "FlexDay"("date");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Room_name_key" ON "Room"("name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Room_name_idx" ON "Room"("name");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Club_googleCalendarId_key" ON "Club"("googleCalendarId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Club_ownerId_idx" ON "Club"("ownerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Club_defaultRoomId_idx" ON "Club"("defaultRoomId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ClubSession_flexDayId_idx" ON "ClubSession"("flexDayId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ClubSession_clubId_idx" ON "ClubSession"("clubId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ClubSession_roomOverrideId_idx" ON "ClubSession"("roomOverrideId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SessionRotationCoverage_primaryTeacherId_idx" ON "SessionRotationCoverage"("primaryTeacherId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SessionRotationCoverage_secondaryTeacherId_idx" ON "SessionRotationCoverage"("secondaryTeacherId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SessionRotationCoverage_sessionId_rotation_key" ON "SessionRotationCoverage"("sessionId", "rotation");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Signup_studentId_idx" ON "Signup"("studentId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Signup_clubSessionId_idx" ON "Signup"("clubSessionId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Signup_studentId_clubSessionId_key" ON "Signup"("studentId", "clubSessionId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Club" ADD CONSTRAINT "Club_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Club" ADD CONSTRAINT "Club_defaultRoomId_fkey" FOREIGN KEY ("defaultRoomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ClubSession" ADD CONSTRAINT "ClubSession_flexDayId_fkey" FOREIGN KEY ("flexDayId") REFERENCES "FlexDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ClubSession" ADD CONSTRAINT "ClubSession_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ClubSession" ADD CONSTRAINT "ClubSession_roomOverrideId_fkey" FOREIGN KEY ("roomOverrideId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "SessionRotationCoverage" ADD CONSTRAINT "SessionRotationCoverage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ClubSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "SessionRotationCoverage" ADD CONSTRAINT "SessionRotationCoverage_primaryTeacherId_fkey" FOREIGN KEY ("primaryTeacherId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "SessionRotationCoverage" ADD CONSTRAINT "SessionRotationCoverage_secondaryTeacherId_fkey" FOREIGN KEY ("secondaryTeacherId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Signup" ADD CONSTRAINT "Signup_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Signup" ADD CONSTRAINT "Signup_clubSessionId_fkey" FOREIGN KEY ("clubSessionId") REFERENCES "ClubSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
