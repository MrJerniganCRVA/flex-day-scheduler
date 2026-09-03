-- Drop the per-club "rotating teachers" pool.
--
-- ClubTeacher recorded which teachers took turns running a club. It granted no
-- permission to edit the club, put the club in nobody's "My Clubs" list, and no
-- code ever rotated through it: its only effect was to sort pool members to the
-- top of the Coverage page dropdown. That is not worth a checkbox list of the
-- whole staff on every club form, or a fourth teacher-shaped concept beside
-- Owner, Cosponsor and Coverage.
--
-- The workflow it existed to support is unchanged and already supported without
-- it: leave Club.ownerId null (admin-managed), and an admin assigns whoever is
-- teaching each session on the Coverage page. Club.ownerId stays nullable.
--
-- Existing rows are dropped rather than migrated. Nothing depended on them —
-- not signups, calendars, permissions, attendance, or the roster CSV — so there
-- is nothing to preserve, and guessing coverage assignments from a pool would
-- invent double-bookings.

DROP TABLE "ClubTeacher";
