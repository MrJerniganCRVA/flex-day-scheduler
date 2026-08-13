-- Change Club.owner from ON DELETE CASCADE to ON DELETE RESTRICT.
-- Previously, deleting a teacher user cascaded through Club -> ClubSession ->
-- Signup/SessionRotationCoverage, permanently destroying that teacher's
-- clubs and all associated session/attendance/signup history. Ownership
-- must now be reassigned before a teacher who owns clubs can be removed.
ALTER TABLE "Club" DROP CONSTRAINT "Club_ownerId_fkey";
ALTER TABLE "Club" ADD CONSTRAINT "Club_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
