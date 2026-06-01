-- ============================================================
-- Flex Day Club Scheduler — Database Bootstrap
-- Derived from prisma/schema.prisma
--
-- Run against a FRESH PostgreSQL database:
--   psql "$DATABASE_URL" -f prisma/schema.sql
--
-- If you need to reset an existing database first, uncomment:
--   DROP TABLE IF EXISTS "Signup","ClubSession","Club","FlexDay",
--     "VerificationToken","Session","Account","User" CASCADE;
--   DROP TYPE IF EXISTS "RotationSlot", "Role";
-- ============================================================

BEGIN;

-- ─── Enums ──────────────────────────────────────────────────────────────────

CREATE TYPE "Role" AS ENUM ('STUDENT', 'TEACHER', 'ADMIN');
CREATE TYPE "RotationSlot" AS ENUM ('FLEX_1', 'FLEX_2', 'FLEX_3');
CREATE TYPE "AbsenceType" AS ENUM ('ABSENT', 'REASSIGNED');

-- ─── Tables (in FK-dependency order) ────────────────────────────────────────

-- User (no FK deps)
CREATE TABLE "User" (
  "id"        TEXT         NOT NULL,
  "email"     TEXT         NOT NULL,
  "name"      TEXT         NOT NULL,
  "image"     TEXT,
  "role"      "Role"       NOT NULL DEFAULT 'STUDENT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- Account (NextAuth; depends on User)
CREATE TABLE "Account" (
  "id"                TEXT    NOT NULL,
  "userId"            TEXT    NOT NULL,
  "type"              TEXT    NOT NULL,
  "provider"          TEXT    NOT NULL,
  "providerAccountId" TEXT    NOT NULL,
  "refresh_token"     TEXT,
  "access_token"      TEXT,
  "expires_at"        INTEGER,
  "token_type"        TEXT,
  "scope"             TEXT,
  "id_token"          TEXT,
  "session_state"     TEXT,
  CONSTRAINT "Account_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Account_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- Session (NextAuth; depends on User)
CREATE TABLE "Session" (
  "id"           TEXT         NOT NULL,
  "sessionToken" TEXT         NOT NULL,
  "userId"       TEXT         NOT NULL,
  "expires"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Session_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Session_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- VerificationToken (NextAuth; no FK deps)
CREATE TABLE "VerificationToken" (
  "identifier" TEXT         NOT NULL,
  "token"      TEXT         NOT NULL,
  "expires"    TIMESTAMP(3) NOT NULL
);

-- FlexDay (no FK deps)
CREATE TABLE "FlexDay" (
  "id"        TEXT         NOT NULL,
  "date"      DATE         NOT NULL,
  "label"     TEXT,
  "isActive"  BOOLEAN      NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FlexDay_pkey" PRIMARY KEY ("id")
);

-- Club (depends on User)
CREATE TABLE "Club" (
  "id"               TEXT         NOT NULL,
  "name"             TEXT         NOT NULL,
  "description"      TEXT,
  "maxCapacity"      INTEGER      NOT NULL,
  "location"         TEXT,
  "googleCalendarId" TEXT,
  "ownerId"          TEXT         NOT NULL,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Club_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Club_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- ClubSession (depends on FlexDay, Club)
CREATE TABLE "ClubSession" (
  "id"            TEXT             NOT NULL,
  "flexDayId"     TEXT             NOT NULL,
  "clubId"        TEXT             NOT NULL,
  "rotations"     "RotationSlot"[],
  "googleEventId" TEXT,
  "createdAt"     TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3)     NOT NULL,
  CONSTRAINT "ClubSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ClubSession_flexDayId_fkey"
    FOREIGN KEY ("flexDayId") REFERENCES "FlexDay"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ClubSession_clubId_fkey"
    FOREIGN KEY ("clubId") REFERENCES "Club"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- TeacherFlexDayAbsence (depends on User, FlexDay)
CREATE TABLE "TeacherFlexDayAbsence" (
  "id"        TEXT           NOT NULL,
  "userId"    TEXT           NOT NULL,
  "flexDayId" TEXT           NOT NULL,
  "rotation"  "RotationSlot" NOT NULL,
  "type"      "AbsenceType"  NOT NULL,
  CONSTRAINT "TeacherFlexDayAbsence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TeacherFlexDayAbsence_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TeacherFlexDayAbsence_flexDayId_fkey"
    FOREIGN KEY ("flexDayId") REFERENCES "FlexDay"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- Signup (depends on User, ClubSession)
CREATE TABLE "Signup" (
  "id"            TEXT         NOT NULL,
  "studentId"     TEXT         NOT NULL,
  "clubSessionId" TEXT         NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Signup_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Signup_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Signup_clubSessionId_fkey"
    FOREIGN KEY ("clubSessionId") REFERENCES "ClubSession"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- ─── Unique indexes ──────────────────────────────────────────────────────────

CREATE UNIQUE INDEX "User_email_key"
  ON "User"("email");
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key"
  ON "Account"("provider", "providerAccountId");
CREATE UNIQUE INDEX "Session_sessionToken_key"
  ON "Session"("sessionToken");
CREATE UNIQUE INDEX "VerificationToken_token_key"
  ON "VerificationToken"("token");
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key"
  ON "VerificationToken"("identifier", "token");
CREATE UNIQUE INDEX "FlexDay_date_key"
  ON "FlexDay"("date");
CREATE UNIQUE INDEX "Club_googleCalendarId_key"
  ON "Club"("googleCalendarId");
CREATE UNIQUE INDEX "Signup_studentId_clubSessionId_key"
  ON "Signup"("studentId", "clubSessionId");
CREATE UNIQUE INDEX "TeacherFlexDayAbsence_userId_flexDayId_rotation_key"
  ON "TeacherFlexDayAbsence"("userId", "flexDayId", "rotation");

-- ─── Regular indexes ─────────────────────────────────────────────────────────

CREATE INDEX "User_email_idx"            ON "User"("email");
CREATE INDEX "FlexDay_date_idx"          ON "FlexDay"("date");
CREATE INDEX "Club_ownerId_idx"          ON "Club"("ownerId");
CREATE INDEX "ClubSession_flexDayId_idx" ON "ClubSession"("flexDayId");
CREATE INDEX "ClubSession_clubId_idx"    ON "ClubSession"("clubId");
CREATE INDEX "Signup_studentId_idx"                            ON "Signup"("studentId");
CREATE INDEX "Signup_clubSessionId_idx"                        ON "Signup"("clubSessionId");
CREATE INDEX "TeacherFlexDayAbsence_userId_idx"                ON "TeacherFlexDayAbsence"("userId");
CREATE INDEX "TeacherFlexDayAbsence_flexDayId_idx"             ON "TeacherFlexDayAbsence"("flexDayId");

COMMIT;
