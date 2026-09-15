# Flex Day Scheduler

A Next.js web app for scheduling school flex days. Students sign up for club sessions, teachers manage their clubs and record attendance, and admins coordinate coverage, finalize rosters, and sync calendar invites via Google Calendar.

## Tech Stack

- **Framework**: Next.js 16 (App Router) + React 19
- **Database**: PostgreSQL via Prisma ORM
- **Auth**: NextAuth.js v5 (Google OAuth, domain-restricted)
- **Calendar**: Google Calendar API (OAuth, as the covering teacher)
- **Styling**: Tailwind CSS v4

## Prerequisites

- Node.js 20+
- A PostgreSQL database (local or hosted — Supabase, Railway, etc.)
- A Google Cloud project with:
  - OAuth 2.0 credentials (used for both user login and calendar invites)
  - The Google Calendar API enabled

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env.local
```

Fill in each value in `.env.local`:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `AUTH_SECRET` | Random secret — generate with `openssl rand -base64 32` |
| `NEXTAUTH_URL` | Base URL of the app (e.g. `http://localhost:3000`) |
| `AUTH_GOOGLE_ID` | Google OAuth client ID |
| `AUTH_GOOGLE_SECRET` | Google OAuth client secret |
| `ALLOWED_EMAIL_DOMAIN` | Only users from this domain can sign in (e.g. `school.org`) |
| `SCHOOL_TIMEZONE` | IANA timezone name (e.g. `America/New_York`) |
| `FLEX_1_START` / `FLEX_1_END` | Bell times for rotation 1 (24h, e.g. `09:00`) |
| `FLEX_2_START` / `FLEX_2_END` | Bell times for rotation 2 |
| `FLEX_3_START` / `FLEX_3_END` | Bell times for rotation 3 |
| `SEED_ADMIN_EMAIL` | Email to promote to ADMIN on first seed |

### 3. Google Cloud setup

**OAuth credentials** (for user login):
1. Go to Google Cloud Console → APIs & Services → Credentials
2. Create an OAuth 2.0 Client ID (Web application)
3. Add `{NEXTAUTH_URL}/api/auth/callback/google` as an authorized redirect URI
4. Copy the client ID and secret into `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`

**Calendar access** (same OAuth client, no service account):

Invites are created by the teacher covering each block, not by the app's own
identity — see [Calendars](#calendars) for why. That needs two additions to the
OAuth client you just made:

1. OAuth consent screen → add the scope `https://www.googleapis.com/auth/calendar.events`.
   Confirm **User type is Internal**: an internal app needs no Google verification
   for a sensitive scope, an External one does.
2. Credentials → your OAuth 2.0 Client ID → Authorized redirect URIs → add
   `{NEXTAUTH_URL}/api/calendar/callback`.
3. Enable the Google Calendar API for the project.

If your Workspace restricts third-party apps (Admin console → Security → API
controls → App access control), the app may also need allowlisting there.

Each teacher then allows access once, from their own dashboard. No service
account is involved, and `GOOGLE_SERVICE_ACCOUNT_*` are no longer read.

### 4. Set up the database

Run migrations and seed the first admin user:

```bash
npm run db:migrate   # applies all Prisma migrations
npx prisma db seed   # creates the SEED_ADMIN_EMAIL admin account
```

On subsequent `npm start` runs, `db-init.ts` runs automatically before the server starts and applies any pending migrations.

## Running Locally

```bash
npm run dev    # development server with hot reload
npm start      # production mode (runs migrations, then starts Next.js)
```

Open [http://localhost:3000](http://localhost:3000) and sign in with a Google account from the allowed domain.

## Roles

Roles are assigned automatically based on the signing-in user's email subdomain:

| Email pattern | Role |
|---|---|
| `@students.domain` | STUDENT |
| `@domain` | TEACHER |

Admins can promote any user to ADMIN (or change roles) from the admin panel. The first admin must be set via `SEED_ADMIN_EMAIL` and seeded.

**Support staff hold TEACHER, and that is deliberate.** Front office, counselling
and other staff who never host a club still sign in from `@domain`, so they land
on TEACHER like everybody else. There is no fourth role for them: what they
actually need on a Flex Day is to know what is running and where, which is the
read-only **Who's Where** board below — safe for any member of staff to see, and
already visible to most of them, since coverage puts teachers on that grid.
Giving them ADMIN instead would let them reassign coverage; giving them a role of
their own would mean a migration, another branch in `src/proxy.ts` and a re-audit
of every role check in the API for no gain.

## How It Works

**Flex Days** are scheduled events (always Wednesdays at this school) with up to three rotation slots (Flex 1, Flex 2, Flex 3).

**Clubs** are created by teachers and assigned to one or more rotation slots per flex day. A club can span multiple rotations (a "linked" session) for activities that need a longer block.

**Students** browse available sessions for each flex day and sign up, subject to rotation conflicts and capacity limits. Signups close at a configurable deadline before the flex day.

**Required members** are students whose attendance at a club is mandatory —
Yearbook staff, club officers. See below.

**Coverage** is assigned by admins — each session needs a primary teacher (and optionally a secondary for large groups). Teacher availability across rotations is shown in real time, and anyone expected in two places at once is flagged.

**Who's Where** (`/teacher/building`) is the same grid without the dropdowns,
open to every teacher: the whole building's next Flex Day, a row per club and a
column per rotation, showing the room, the teachers covering each block, the head
count, and every duty post with its location. It is read-only and there is no
route behind it to write to. See [Who's Where](#whos-where) below.

**Duty posts** are supervision spots that aren't clubs — hallways, the cafeteria, the front doors. Admins define them under **Duty Posts** and staff them per rotation from the Coverage page.

**Finalization** sends the invites: one calendar event per *rotation* of each session, created by that rotation's T1 on their own calendar, with the block's other teachers and every signed-up student as guests. The flex day can be unfinalized to make corrections and re-send.

## Who's Where

`/teacher/building` answers one question — *what is happening in each part of the
building on the next Flex Day?* — for anyone on staff.

It exists because the people who most need that answer had no way to get it. The
admin **Coverage** page has always held it, but Coverage is also where coverage
is *changed*, so it is ADMIN-only. Support staff are not admins and run no clubs,
which left them with an empty teacher dashboard and nowhere to look. This is the
Coverage grid with every control removed:

- one row per club, alphabetical, three columns for Flex 1 / 2 / 3, so a club can
  be followed across the day
- each cell names the teachers covering that block, the head count, and the room
  when the row's sessions disagree about it
- duty posts share the grid, marked with a **Duty** pill and showing their
  location — the hallways and doors are as much a part of the building as the
  classrooms
- a club with nobody assigned reads *"No teacher listed"* in grey, not red.
  Coverage colours a gap because a gap is a job an admin can do something about;
  here it is only a fact, and colouring a fact somebody cannot act on trains them
  to ignore the colour

It shows the soonest upcoming active Flex Day, with no day picker, exactly as
Coverage does.

**Student names are deliberately absent.** The head count says how busy a room
will be, which is what somebody walking the corridors needs; the roster is the
business of whoever is standing in it.

### Where the shared logic lives

Both grids are drawn from `src/lib/flex-day-board.ts` (the query, with coverage
resolved through `src/lib/coverage.ts`) and `src/lib/board-rows.ts` (the pure
rules for folding sessions into rows — an unlinked club is three `ClubSession`
rows and one grid row). That split is the same argument the header of
`src/lib/coverage.ts` makes: two copies of these rules would be two chances for
the read-only board to quietly disagree with the page an admin is editing.

`board-rows.ts` imports no Prisma, for the reason `src/lib/reconcile.ts` gives —
`src/lib/prisma.ts` throws without `DATABASE_URL`, which would make every test of
those rules need a database it has no use for. The rules are unit-tested in
`src/lib/board-rows.test.ts`.

The two screens do *not* share a renderer. `CoverageDashboard.tsx` is a client
component whose cells take `onAssign`, `saveStatus` and `onUndoAbsence`, and
whose parent holds optimistic state and a pending-save counter; threading "but
not really" through all of it would make the editable page harder to reason about
in order to save the ~240-line server component in
`src/components/dashboard/BuildingBoard.tsx`.

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start development server |
| `npm start` | Validate env, run migrations, then start production server |
| `npm run build` | Build for production |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Type-check without emitting |
| `npm test` | Run the unit test suite (no database required) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run db:migrate` | Apply pending Prisma migrations |
| `npm run db:push` | Push schema changes without migrations (dev only) |
| `npm run db:seed` | Seed first admin user |
| `npm run db:studio` | Open Prisma Studio |

## Environment Validation

Every variable in the table above except `AUTH_URL`/`NEXTAUTH_URL` and
`SEED_ADMIN_EMAIL` is **required**, and is validated by `src/lib/env.ts` before
the server starts (`npm start` runs `assertEnv()` via `scripts/db-init.ts`). A
misconfigured deploy fails at boot with every problem listed at once, rather than
starting up and behaving subtly incorrectly.

Validation catches the mistakes that used to be silent:

- `ALLOWED_EMAIL_DOMAIN` written as `@school.org` instead of `school.org` — the
  leading `@` made the domain check reject **every** login.
- Missing `FLEX_*` bell times — these fell back to the placeholder 09:00/10:00/11:00
  values from `.env.example`, so real calendar invites went out at the wrong times.
- A `FLEX_*_END` earlier than its `FLEX_*_START`, or an unresolvable
  `SCHOOL_TIMEZONE`.

Validation is lazy at import, so `npm run build` does not need runtime secrets.

## What an Invite Says

Finalizing a Flex Day sends **one calendar event per rotation of each session**,
to the students signed up for that session and the teachers covering that block.

**One event per rotation, not one per session.** A club linked across Flex 1 to
Flex 3 sends three invites — 09:00–09:50, 10:00–10:50, 11:00–11:50 — rather than
a single 09:00–11:50 block. Two reasons, and both matter:

- The transition gaps between rotations stay free on everyone's calendar. The
  school uses them to move between rooms; a spanning event swallowed them.
- Each event carries only *its own* block's coverage. A sponsor who runs this
  club in Flex 1 and Flex 3 but a different one in Flex 2 is on the Flex 1 and
  Flex 3 invites and not on the Flex 2 one — whether an admin marked them absent
  or assigned somebody else. Under one spanning event that was impossible:
  Google has no concept of a guest attending part of an event.

**Sent by the teacher, not by the app.** Each event is created by that
rotation's **T1 on the Coverage page**, on their own Google Calendar, so the
invite comes from the person standing in the room. Different blocks of one
session can therefore have different senders. See [Calendars](#calendars).

**Who is invited.** The block's other teachers — its T2, and a different T1 on
another rotation — plus every student signed up for the session. The organizer
is not listed as a guest because Google adds them as organizer already.
Absences are subtracted first, per rotation.

**Title: `Art Club (Room 205)`** — the club's name (or a one-off's own title)
and the room it meets in. The room is in the *title* deliberately, not only in
Google's Location field: most calendar views don't show Location until you open
the event, and the point is for a student scanning a week at a glance to see
which door to walk through. Location is populated too, so the event's "where"
row and map link still work.

The rotation is **not** in the title — the event's start and end times already
say which block it is.

**Body:**

```
Room: Room 205
When: Flex 1
Teacher: Ms Rivera
```

`When` names this event's own block, and `Teacher` the teachers covering it — so
an admin-managed club with nobody assigned omits the line rather than printing
an empty one.

**A club with no room** falls back to the rotation: `Art Club (Flex 1)`, and the
body reads `Room: not yet assigned`. Every club has a room today, so this should
never appear; the admin Flex Day page shows an amber **No room** badge on any
session that would produce it, which is the last place to catch it before
pressing Finalize.

Wording lives in `src/lib/session-event.ts` and is unit-tested. The room itself
is resolved the same way everywhere — a session's `roomOverride` wins over its
club's `defaultRoom` — through `resolveRoomName` in that same module.

### Re-finalizing updates the whole event

Unfinalize, fix a room, re-finalize, and the invites are corrected: title,
location, body and attendee list are all patched together, and attendees are
notified. This previously synced the attendee list *only*, so a corrected room
never reached anybody's calendar.

If a block's T1 has **changed** since the last send, the old event is withdrawn
and a new one issued from the teacher now covering it. Google cannot move an
event between calendars, so this is the only way to make the invite come from
the right person. If a rotation was **removed** from the session, its event is
cancelled.

Two narrower paths still don't fully resync, and are worth knowing before you
rely on them: renaming a club after finalize leaves existing events on the old
text, and the per-day one-off editor can change a room without touching Google
(the club-scoped session editor does it correctly, including cancelling a
dropped rotation's invite — but it cannot *create* one for a newly added
rotation, because picking that block's sender needs coverage it hasn't loaded).
Re-finalizing the day fixes any of these.

## Calendars

There are no app-owned calendars. Every event lives on the **personal calendar
of the teacher who sent it**, and there is no per-club calendar, no shared
one-off calendar, and no calendar sharing of any kind.

### Why, and the one thing it asks of teachers

The app originally created events with a Google **service account**. That does
not work, and cannot be made to work here: Google rejects an event carrying
attendees from an unimpersonated service account —

> Service accounts cannot invite attendees without Domain-Wide Delegation of
> Authority.

Domain-Wide Delegation is granted by a Workspace **super-admin**, which this
deployment does not have. The alternative Google supports is ordinary OAuth: a
real signed-in user may invite whoever they like.

So each teacher allows calendar access **once**, from a banner on their
dashboard (a first visit redirects there automatically, so it reads as part of
signing in). Google returns a refresh token that stays valid until they revoke
it. This is the one step that cannot be automated away — and it is the reason
invites now visibly come from the teacher running the room, which is better than
a faceless service account regardless.

**Students are never asked for anything.** The calendar scope is requested only
from teachers and admins. A student receives an ordinary event invitation with
Yes / No / Maybe, never a request to subscribe to a calendar.

**No sign-out is needed** to roll this out to teachers who are already signed
in. The consent is a separate authorization against the same OAuth client, not a
login, so their session is untouched. (This is why the scope is deliberately
*not* added to the Google provider in `src/auth.ts` — Auth.js would not re-run
authorization for existing sessions, and every teacher would have to sign out
and back in first.)

### When a teacher hasn't connected

Their students still get invited. Finalize falls back to the calendar of the
admin pressing the button — or any admin who has connected — and reports each
block it had to send that way, naming the teacher. The admin **Coverage** page
also lists teachers on the upcoming Flex Day who have not connected, so they can
be chased before invites go out rather than after.

If no admin has connected either, those blocks are skipped and reported. A
finalize where *nothing* could be sent refuses outright rather than marking the
day green.

### Where the record lives

`SessionCalendarEvent` holds one row per `[session, rotation]`: the Google event
id and the id of the user whose calendar it is on. That owner column is what
makes an event findable again — with events spread across teachers' own
calendars, it cannot be derived from the club the way a club calendar id once
was.

Splitting or linking sessions does not touch Google at all: the rows simply
follow their rotation to the session that now owns it, so restructuring a day
re-sends nothing to anybody.


## Roster CSV Export (the offline fallback)

Admins can download a Flex Day's full roster as a CSV — from **Export CSV** on
the Flex Day page, or the **CSV** link in the Flex Days list. It is the
contingency plan for the app being unavailable on a Flex Day morning: the file
stands on its own, so staff can direct students from a printout with no app
involved. Download it once signups close, before the day itself.

Columns, in this fixed order:

| Column | Value |
|---|---|
| `student_id` | Local part of the school email (`jdoe27@students.coderva.org` → `jdoe27`) |
| `email` | Full school email address |
| `grade_level` | Currently the constant `9` — see below |
| `F1` / `F2` / `F3` | Name of the club the student is in for that rotation, blank if none |

One row per student who has at least one signup that day, ordered by email so
two downloads of the same day are diffable. A session spanning several rotations
fills each of its columns with the same name: a student in Esports for all three
reads `Esports,Esports,Esports`, not one name and two blanks.

Club names are free text, so the file is RFC 4180 quoted (a club called
`Drama, "Stage" & Set` survives a round trip) and carries CRLF endings and a
UTF-8 BOM so Excel opens it correctly.

**`student_id` and `grade_level` are derived, not stored.** Accounts come from
Google sign-in, which supplies only a name and an email — the app has never held
a student number or a grade level. The email local part is used as the id
because it is stable, unique, and is what school systems key on, where the
internal cuid would be meaningless outside this database. `grade_level` is a
placeholder constant so the column is present and populated for downstream
invite tooling. Both are computed in `src/lib/csv-export.ts` and are the two
things to revisit if the app ever gains real student records.

## Student Roster: Export and Import

A student's account is normally created by Google sign-in the first time they log
in. Left at that, **a student who has never opened the site does not exist here
at all** — invisible to every "not signed up" figure in the app, because those
are computed over the students the app knows about, and beyond the reach of
auto-assign, which can place a student who forgot to pick a club but not one it
has never heard of.

Export and import are the two halves of closing that gap, and they are meant to
be used together:

1. **Export students** on the admin Users page (students tab) downloads what the
   app *does* know. Diff the `email` column against the school's master student
   list in a spreadsheet; anyone present there but missing here has never signed
   in.
2. **Import students** on the same page takes that file back. Add the missing
   students to the bottom of it and upload — the extra columns are ignored, and
   students already present are skipped, so re-uploading the same file is a
   no-op.

Once a student has an account they are an ordinary student, whether or not they
have ever logged in: included in Auto-assign for the next Flex Day, and sent a
Google Calendar invite when that day is finalized. Nothing about the invite
depends on them having used the app — it goes to their school address either way.

### Export

| Column | Value |
|---|---|
| `name` | Name from their Google account, or derived from the address if imported and not yet signed in |
| `email` | Full school email address |
| `student_id` | Local part of that email, same derivation as the roster export |
| `signed_up` | `yes` / `no` for the upcoming Flex Day |
| `rotations_covered` | `0`–`3`, distinct rotations they are placed in |

One row per `STUDENT` account, whether or not they have signed up — the exact
inverse of the roster export above, which is driven from signups and so omits
precisely the students this file is for. Rows are ordered with unsigned-up
students first, then by name, so the work is at the top; the email tiebreak
keeps two downloads of an unchanged roster diffable.

`signed_up` and `rotations_covered` describe the next upcoming active Flex Day,
named in the filename (`students-2026-09-09.csv`). Pass `?flexDayId=` to the
endpoint to report against a specific day instead. **When there is no upcoming
Flex Day both columns are blank rather than `no`** — there is nothing to have
signed up for, and a column of `no` would tell the spreadsheet to chase the
entire school.

`rotations_covered` is a count of *distinct rotations*, not of signups: a linked
session covers several rotations in one row, so a student booked solid reads `3`
from a single signup.

Admin-only, like the roster export — it is the whole student body with email
addresses attached. Logic in `src/lib/student-roster-export.ts`, route in
`src/app/api/admin/students/export/route.ts`.

### Import

Upload a CSV of students. The `email` column is the only one that matters;
`name` is used when present and otherwise derived from the address
(`jane.doe@…` → "Jane Doe"), which is a placeholder — the student's real Google
name replaces it the first time they sign in. Column order is irrelevant, extra
columns are ignored, and a file with no header at all is read as a bare list of
addresses.

The upload is previewed before anything is written: how many students are new,
how many are already here, and every row that will be skipped with its line
number and the reason. Rows are skipped rather than failing the upload, so one
malformed line in two thousand costs you that line and not the import.

A row is skipped when it has no address, when the address is malformed, when it
is **not at the school's domain** (that account could never sign in), when it is
a **staff address** (importing a teacher as a student would have them silently
promoted to `TEACHER` at their next login), or when the same address appeared
earlier in the file. Existing accounts are never modified — no renames, and no
role changes for anyone already on file.

Admin-only. Parsing in `src/lib/student-import.ts` (pure, and the exact inverse
of the quoting in `src/lib/csv-export.ts`), route in
`src/app/api/admin/students/import/route.ts`.

**Invites go out at finalize, not at import.** A student imported and
auto-assigned *after* a Flex Day has already been finalized gets no invite until
that day is unfinalized and re-finalized, or they are added through the admin
roster override. This is existing behavior — equally true of a student who signs
up late — but it is the reason to import before you finalize.

Pre-creating accounts this way requires Auth.js to attach a Google login to a
`User` row that already exists, which is why the Google provider sets
`allowDangerousEmailAccountLinking` (`src/auth.ts`). Without it every imported
student would be refused with `OAuthAccountNotLinked` on their first sign-in. It
is safe here because Google is the only provider, it verifies the addresses it
issues, and sign-in is confined to the school's own Workspace domain — adding a
second provider would make it unsafe.

## Coverage, and Taking a Teacher Off a Session

Who is in the room is *derived*, not stored: with no explicit assignment, T1 falls
back to the club's owner (or a one-off's creator) and T2 to the cosponsor. That is
what keeps coverage correct when a club changes hands, but it means an empty slot
is ambiguous, so each slot carries a "cleared" flag alongside its teacher id:

| T1 shows | Meaning |
|---|---|
| a teacher | explicitly assigned |
| `Owner (name)` | nobody assigned — fall back to the club's owner |
| `None — needs cover` | deliberately nobody; the rotation is flagged as needing cover |

Without that third state, choosing "None" wrote a null the owner fallback
immediately undid — the page reported **Saved ✓** and reverted on reload, and an
admin had no way to take a double-booked teacher off one of their two clubs.

There are two ways to remove someone, and they mean different things:

- **`None — needs cover`** empties *the slot*. It survives a change of club owner
  (the new owner isn't defaulted in either).
- **`Not here`** records that *this person* isn't attending, as a
  `SessionTeacherAbsence`. Better for a double-booking: it names who and why, shows
  on that teacher's own dashboard so they can see and undo it, and lets a new owner
  default in normally.

Either one resolves a clash. Clashes are **warned about, never blocked** — it is
legitimate to know about one and sort it out later.

### Clubs with no permanent teacher

A club does not need an owner. When several teachers take turns running one, or
nobody is permanently responsible for it, an admin creates it with **No teacher
assigned (admin-managed)** and sets who is actually teaching each session here on
the Coverage page.

Such a club has no owner to fall back to, so every one of its rotations shows
`None — needs cover` until somebody is assigned — which is the point: it is
visible on the one screen that answers "who still needs a teacher", every Flex
Day, rather than quietly defaulting to a name that isn't really going to be there.

Two consequences worth knowing:

- **The assigned teacher can take the register.** Attendance follows coverage, not
  ownership, so whoever is assigned that session can record it without owning the
  club.
- **Only admins can edit the club itself** — its rotations, capacity, required
  members. Ownership is the permission to edit, and there is nobody holding it. If
  one of the teachers should be able to edit too, make them the **cosponsor**,
  which grants full co-owner rights without making them the club's face.

There is deliberately no separate list of "teachers who rotate through this club".
One existed and did nothing but reorder a dropdown: it granted no permissions,
never assigned anybody, and added a fourth teacher-shaped field to every club form
beside Owner, Cosponsor and Coverage. Coverage is the record of who is teaching.

## Duty Posts

Supervision that isn't a club. Defined under **Duty Posts** (admin only) with a
name, an optional location, and the rotations it must be staffed for; teachers are
assigned to them per Flex Day from the Coverage page, under **Building coverage**.

Only the required rotations get a slot, so a blank always means "needs someone"
rather than "not needed here", and the group header carries the count that answers
the actual question — `2 of 7 unstaffed`.

Duty posts are a separate model from `ClubSession` on purpose. Everything
student-facing reaches sessions through `flexDay.clubSessions` or
`signup.clubSession` — the student pages, signups, the roster CSV, auto-assign and
calendar finalize — so a separate table is invisible to all of them with no changes
to any of those queries. A duty post modelled as a club with a flag would have
needed a correct exclusion in every one of them, and the first one missed would
have offered a hallway to students to sign up for, or auto-assigned a student into
it (`Club.allowRandomAssignment` defaults to true).

Duty assignments count toward double-booking detection, and a teacher already
covering a club in a rotation is not offered for duty in it. Retire a post with
**Deactivate**, which keeps the record of who covered it; **Delete** cascades those
records away.

## Required Members (mandatory attendance)

Some club attendance isn't a choice. On a club's page — teacher or admin — the
**Required Members** panel names the students who must attend: Yearbook staff,
club officers, anyone who has to be in that room every time.

A required member is signed up automatically for every upcoming session the club
has, and for every session it is given afterwards — when a new Flex Day is
created, when the club's rotations are edited, and when a teacher schedules one
by hand. Their signup shows as **Required** rather than cancellable, and the API
refuses a student's attempt to cancel it.

The roster is managed by whoever manages the club (admin, owner, or cosponsor).
Two rules are worth knowing before you use it:

- **A required signup wins.** If the student had already chosen something else in
  that rotation, that signup is cancelled for them (and recorded in the Flex
  Day's **Changes** tab, with the club that displaced it). If the session is
  full, they are added anyway and the panel tells you it is now over capacity.
  A room's stated capacity does not stop a student who has to be there.
- **Already-finalized Flex Days are left alone**, because their invites have gone
  out. The panel says which days were skipped; add the student to those with the
  admin roster override below.

Removing a student from the roster drops their forced signups on upcoming Flex
Days and withdraws any calendar invite already sent. Past signups stay — they are
attendance history.

If two clubs both require the same student in the same rotation, the second one
is refused and names the first. There is no correct automatic answer to that, and
picking one silently would hide a scheduling mistake.

## Changing a Roster After Invites Are Sent

Once a Flex Day is finalized, students are past their signup deadline and cannot
change anything themselves. Admins can still make exceptions, from either of two
screens. Both bypass the deadline and the finalized flag, both require a reason,
both are recorded in the **Changes** tab for that Flex Day, and both update the
calendar **for the affected student only** — other students on the session are
not re-notified. A session linked across rotations has an invite per block, and
the student is added to or removed from all of them.

### From the session: Move and Remove

On the Flex Day page, expand a session's roster and use **Move** or **Remove**
beside a student. This is the quickest route when you are already looking at a
roster and one name in it is wrong. It enforces room capacity and rotation
conflicts, and only appears once the day is finalized — before that, students
manage their own signups.

### From the student: Student Signups

**Student Signups** (admin nav) starts from the student instead. Type their
email — the whole address, or just the part before the `@` — and their placement
on every upcoming Flex Day appears as three rotation slots. Change the clubs,
type one reason, and **Apply changes & update invites** writes the lot: one
transaction, one audit reason copied onto every change it records, and exactly
the calendar removals and additions the change implies.

Use this one when a student's whole day needs rearranging, when you do not
already know which sessions they are in, or when you need to change several Flex
Days at once. Three differences from the per-session override are worth knowing:

- **It works before finalization too.** A session whose invites have not been
  sent has no calendar events, so the calendar step simply finds nothing to do
  and the signup still moves. There is no need to wait for, or undo, a
  finalize.
- **Room capacity is a warning, not a wall.** Going over capacity asks you to
  confirm and then allows it — the same rule as required members, where a
  student who has to be in a room is in it whether or not the room is nominally
  full. A **rotation clash is still refused outright**: that is a student in two
  rooms at once, which is not a policy to override.
- **Multi-day edits are all-or-nothing.** Change two Flex Days in one apply and
  either both are written or neither is.

Picking a club that spans several rotations fills all of them, and gives up
whatever was in those rotations before — each displacement shows as its own line
in the staged-changes list before you commit, so nothing moves silently.

Removing a **required member's** signup works, but does not end the membership:
the club will sign them up again for its next session. To stop that, remove them
from the club's Required Members panel instead.

Past Flex Days are listed read-only. Those signups are attendance history.

## Testing

```bash
npm test
```

Unit tests only — no database, no browser, no network, no secrets. They cover the
logic where a silent error is most expensive: the DST-aware signup deadline math
(`src/lib/flex-day-utils.ts`), the participation statistics behind the admin
dashboard, coverage resolution, environment validation, and the club
authorization predicate. CI (`.github/workflows/ci.yml`) runs lint, typecheck,
tests, and `prisma validate` on every push.
