-- AlterTable: let an admin say "this rotation needs no second teacher".
--
-- Since the cosponsor became the default T2, clearing the slot was impossible:
-- writing secondaryTeacherId = NULL just let the fallback re-derive the cosponsor.
-- The two states can't be distinguished from the null alone, because coverage rows
-- are upserted per field — setting T1 creates a row whose secondary is null purely
-- as a side effect, which must keep meaning "not set".
--
-- Defaults to false, so every existing row keeps its current behaviour and no
-- backfill is needed.
ALTER TABLE "SessionRotationCoverage"
  ADD COLUMN "secondaryCleared" BOOLEAN NOT NULL DEFAULT false;
