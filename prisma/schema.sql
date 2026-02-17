-- ============================================================
-- Flex Day Club Scheduler — Database Bootstrap
-- Derived from prisma/schema.prisma
-- Run once against a fresh PostgreSQL database via psql or any
-- Postgres client (Railway shell, TablePlus, DBeaver, etc.)
-- Safe to re-run on an existing database (fully idempotent).
-- ============================================================

-- ─── Enums ──────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "Role" AS ENUM ('STUDENT', 'TEACHER', 'ADMIN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "RotationSlot" AS ENUM ('FLEX_1', 'FLEX_2', 'FLEX_3');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Tables (in FK-dependency order) ────────────────────────────────────────

-- User (no FK deps)
CREATE TABLE IF NOT EXISTS "User" (
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
CREATE TABLE IF NOT EXISTS "Account" (
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
CREATE TABLE IF NOT EXISTS "Session" (
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
CREATE TABLE IF NOT EXISTS "VerificationToken" (
  "identifier" TEXT         NOT NULL,
  "token"      TEXT         NOT NULL,
  "expires"    TIMESTAMP(3) NOT NULL
);

-- FlexDay (no FK deps)
CREATE TABLE IF NOT EXISTS "FlexDay" (
  "id"        TEXT         NOT NULL,
  "date"      DATE         NOT NULL,
  "label"     TEXT,
  "isActive"  BOOLEAN      NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FlexDay_pkey" PRIMARY KEY ("id")
);

-- Club (depends on User)
CREATE TABLE IF NOT EXISTS "Club" (
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
CREATE TABLE IF NOT EXISTS "ClubSession" (
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

-- Signup (depends on User, ClubSession)
CREATE TABLE IF NOT EXISTS "Signup" (
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

CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key"
  ON "User"("email");

CREATE UNIQUE INDEX IF NOT EXISTS "Account_provider_providerAccountId_key"
  ON "Account"("provider", "providerAccountId");

CREATE UNIQUE INDEX IF NOT EXISTS "Session_sessionToken_key"
  ON "Session"("sessionToken");

CREATE UNIQUE INDEX IF NOT EXISTS "VerificationToken_token_key"
  ON "VerificationToken"("token");

CREATE UNIQUE INDEX IF NOT EXISTS "VerificationToken_identifier_token_key"
  ON "VerificationToken"("identifier", "token");

CREATE UNIQUE INDEX IF NOT EXISTS "FlexDay_date_key"
  ON "FlexDay"("date");

CREATE UNIQUE INDEX IF NOT EXISTS "Club_googleCalendarId_key"
  ON "Club"("googleCalendarId");

CREATE UNIQUE INDEX IF NOT EXISTS "Signup_studentId_clubSessionId_key"
  ON "Signup"("studentId", "clubSessionId");

-- ─── Regular indexes ─────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS "User_email_idx"            ON "User"("email");
CREATE INDEX IF NOT EXISTS "FlexDay_date_idx"          ON "FlexDay"("date");
CREATE INDEX IF NOT EXISTS "Club_ownerId_idx"          ON "Club"("ownerId");
CREATE INDEX IF NOT EXISTS "ClubSession_flexDayId_idx" ON "ClubSession"("flexDayId");
CREATE INDEX IF NOT EXISTS "ClubSession_clubId_idx"    ON "ClubSession"("clubId");
CREATE INDEX IF NOT EXISTS "Signup_studentId_idx"      ON "Signup"("studentId");
CREATE INDEX IF NOT EXISTS "Signup_clubSessionId_idx"  ON "Signup"("clubSessionId");
