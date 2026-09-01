-- AlterTable: let an admin say "this rotation's primary teacher is nobody".
--
-- The mirror of secondaryCleared, added for the same reason one rotation later.
-- Since the club's owner is the default T1, clearing the slot was impossible:
-- writing primaryTeacherId = NULL just let the fallback re-derive the owner. The
-- Coverage page reported "Saved", and on the next load the owner was back — the
-- admin had no way to take a double-booked teacher off one of their two clubs.
--
-- The two states cannot be told apart from the null alone, because coverage rows
-- are upserted per field: setting T2 creates a row whose primary is null purely
-- as a side effect, which must keep meaning "not set, use the owner".
--
-- Defaults to false, so every existing row keeps its current behaviour and no
-- backfill is needed.
ALTER TABLE "SessionRotationCoverage"
  ADD COLUMN "primaryCleared" BOOLEAN NOT NULL DEFAULT false;
