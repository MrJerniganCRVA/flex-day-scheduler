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

**Clubs** are created by teachers and assigned to one or more rotation slots per flex day. A club can span multiple rotations (a "linked" session) for activities that need a longer block. Clubs can also have **required members** — students who are automatically enrolled in every session of that club regardless of the normal signup flow.

**Students** browse available sessions for each flex day and sign up, subject to rotation conflicts and capacity limits. Signups close at a configurable deadline before the flex day.

**Coverage** is assigned by admins — each session needs a primary teacher (and optionally a secondary for large groups). Teacher availability across rotations is shown in real time. Room assignments can be **admin-locked** to prevent the auto-assign algorithm from overriding a manually chosen room. The system also tracks whether a teacher was reassigned to a session rather than volunteering for it.

**Duty Stations** are non-club locations (hallways, cafeteria, etc.) that require teacher supervision during flex day rotations. Admins create and manage duty stations; teachers volunteer for open slots. Like coverage, individual assignments can be admin-locked to prevent auto-assign from overriding them.

**Teacher Absence** lets teachers mark themselves absent for a specific rotation on a flex day. Absent teachers are excluded from coverage and duty-station assignments for that slot.

**One-Off Sessions** allow admins to create ad-hoc sessions not tied to a standing club for a specific flex day and rotation — useful for assemblies, testing blocks, or other non-recurring activities.

**Finalization** triggers a Google Calendar sync: attendees (students + assigned teachers) are added to each session's calendar event. The flex day can be unfinalized to make corrections and re-send.

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start development server |
| `npm start` | Run migrations then start production server |
| `npm run build` | Build for production |
| `npm run lint` | Run ESLint |
| `npm run db:migrate` | Apply pending Prisma migrations |
| `npm run db:push` | Push schema changes without migrations (dev only) |
| `npm run db:seed` | Seed first admin user |
| `npm run db:studio` | Open Prisma Studio |
