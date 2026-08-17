-- CreateEnum
CREATE TYPE "SignupAuditAction" AS ENUM ('ADD', 'MOVE', 'REMOVE');

-- CreateTable: single-row store for app-owned state with no natural parent.
-- The CHECK constraint enforces the singleton invariant at the database level
-- so a stray insert can't create a second row that callers would never read.
CREATE TABLE "AppConfig" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "oneOffCalendarId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppConfig_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AppConfig_singleton_check" CHECK ("id" = 'singleton')
);

-- CreateTable: immutable audit of admin roster overrides made after invites
-- went out. Session/flex-day columns are intentionally NOT foreign keys —
-- deleting a flex day cascades its sessions away, and the audit row has to
-- outlive them, so the human-readable names are denormalized at write time.
CREATE TABLE "SignupAudit" (
    "id" TEXT NOT NULL,
    "action" "SignupAuditAction" NOT NULL,
    "reason" TEXT NOT NULL,
    "actorId" TEXT,
    "actorEmail" TEXT NOT NULL,
    "studentId" TEXT,
    "studentName" TEXT NOT NULL,
    "fromSessionId" TEXT,
    "fromSessionName" TEXT,
    "toSessionId" TEXT,
    "toSessionName" TEXT,
    "flexDayId" TEXT,
    "flexDayDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignupAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SignupAudit_flexDayId_idx" ON "SignupAudit"("flexDayId");

-- CreateIndex
CREATE INDEX "SignupAudit_studentId_idx" ON "SignupAudit"("studentId");

-- CreateIndex
CREATE INDEX "SignupAudit_createdAt_idx" ON "SignupAudit"("createdAt");

-- AddForeignKey: SetNull on both so deleting a user preserves the audit row
-- (the denormalized actorEmail / studentName keep it readable).
ALTER TABLE "SignupAudit" ADD CONSTRAINT "SignupAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignupAudit" ADD CONSTRAINT "SignupAudit_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
