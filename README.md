# Flex Day Scheduler

A Next.js web app for scheduling school flex days. Students sign up for club sessions, teachers manage their clubs and record attendance, and admins coordinate coverage, finalize rosters, and sync calendar invites via Google Calendar.

## Tech Stack

- **Framework**: Next.js 16 (App Router) + React 19
- **Database**: PostgreSQL via Prisma ORM
- **Auth**: NextAuth.js v5 (Google OAuth, domain-restricted)
- **Calendar**: Google Calendar API (service account)
- **Styling**: Tailwind CSS v4

## Prerequisites

- Node.js 20+
- A PostgreSQL database (local or hosted — Supabase, Railway, etc.)
- A Google Cloud project with:
  - OAuth 2.0 credentials (for user login)
  - A service account with Google Calendar API enabled (for calendar sync)

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
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Service account email for Calendar API |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | Service account private key (replace literal newlines with `\n`) |
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

**Service account** (for Google Calendar):
1. Go to IAM & Admin → Service Accounts → Create service account
2. Enable the Google Calendar API for the project
3. Create a JSON key, download it, and extract `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `private_key` → `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`

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

## How It Works

**Flex Days** are scheduled events (always Wednesdays at this school) with up to three rotation slots (Flex 1, Flex 2, Flex 3).

**Clubs** are created by teachers and assigned to one or more rotation slots per flex day. A club can span multiple rotations (a "linked" session) for activities that need a longer block.

**Students** browse available sessions for each flex day and sign up, subject to rotation conflicts and capacity limits. Signups close at a configurable deadline before the flex day.

**Required members** are students whose attendance at a club is mandatory —
Yearbook staff, club officers. See below.

**Coverage** is assigned by admins — each session needs a primary teacher (and optionally a secondary for large groups). Teacher availability across rotations is shown in real time, and anyone expected in two places at once is flagged.

**Duty posts** are supervision spots that aren't clubs — hallways, the cafeteria, the front doors. Admins define them under **Duty Posts** and staff them per rotation from the Coverage page.

**Finalization** triggers a Google Calendar sync: attendees (students + assigned teachers) are added to each session's calendar event. The flex day can be unfinalized to make corrections and re-send.

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

## Calendars

Each club gets its own Google Calendar, created when the club is created and
shared with its owning teacher the first time one of its Flex Days is finalized.

**One-off sessions** have no club, so they have no club calendar. They live on a
single app-owned calendar ("Flex Day — One-Off Sessions"), created automatically
the first time it's needed and recorded in the `AppConfig` table. It is not
shared with anyone — the session's creator is added as an event *attendee*, which
is what puts it on their personal calendar. Event titles use the session's own
title, so no club name appears on a one-off invite.

If a club's calendar could not be created (a Calendar API outage, bad service
account credentials), the club still works for signups but **cannot send
invites**. The admin Clubs page flags such clubs and offers "Retry calendar
setup". Finalizing a Flex Day reports any session it had to skip for this reason
rather than reporting success.

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
change anything themselves. Admins can still make exceptions — a student turning
up without a required permission slip, for example — from the Flex Day's roster
list: expand a session's roster and use **Move** or **Remove** beside a student.

These overrides bypass the deadline but still enforce room capacity and rotation
conflicts. Each one requires a reason, is recorded in the **Changes** tab for
that Flex Day, and updates the calendar for the affected student only — other
students on the session are not re-notified.

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
