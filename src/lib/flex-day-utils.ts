import { env } from "@/lib/env";

/** IANA timezone the school operates in. All signup deadlines and attendance
 * windows are wall-clock times in this zone, independent of where the server
 * process happens to run.
 *
 * Resolved through a function rather than a module-level const so the env
 * validation stays lazy — see the note in src/lib/env.ts. */
export function schoolTimeZone(): string {
  return env().SCHOOL_TIMEZONE;
}

/**
 * Convert a wall-clock date/time in `timeZone` to the equivalent UTC Date.
 * Uses an Intl.DateTimeFormat offset-correction pass (converges within 2
 * iterations) so DST transitions in `timeZone` are handled correctly.
 */
function zonedTimeToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  for (let i = 0; i < 2; i++) {
    const parts = formatter.formatToParts(new Date(utc));
    const get = (type: string) =>
      Number(parts.find((p) => p.type === type)?.value);
    const asIfUtc = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
      get("second")
    );
    const diff = asIfUtc - utc;
    utc = Date.UTC(year, month - 1, day, hour, minute, 0, 0) - diff;
  }

  return new Date(utc);
}

/** How many calendar days before a Flex Day its signups close. */
export const SIGNUP_DEADLINE_DAYS_BEFORE = 7;

/**
 * Calculate the signup deadline for a given flex day.
 * Deadline is SIGNUP_DEADLINE_DAYS_BEFORE calendar days before the flex day
 * (the same weekday, one week earlier) at 2:56 PM school-local time.
 *
 * `timeZone` defaults to the configured school timezone; it is a parameter so
 * the DST behavior can be tested against fixed zones without env setup.
 */
export function getSignupDeadline(flexDayDate: Date, timeZone?: string): Date {
  const tz = timeZone ?? schoolTimeZone();
  const flexDay = new Date(flexDayDate);

  // Day-offset arithmetic operates purely on the calendar date
  // (dates are stored as UTC midnight in the DB) and is timezone-independent,
  // so it stays in UTC.
  const year = flexDay.getUTCFullYear();
  const month = flexDay.getUTCMonth();
  const day = flexDay.getUTCDate();
  const deadlineDate = new Date(
    Date.UTC(year, month, day - SIGNUP_DEADLINE_DAYS_BEFORE)
  );

  // The deadline is a wall-clock time in the school's timezone — resolve it
  // against that zone so it lands at 2:56 PM there regardless of what
  // timezone the server process itself runs in.
  return zonedTimeToUtc(
    deadlineDate.getUTCFullYear(),
    deadlineDate.getUTCMonth() + 1,
    deadlineDate.getUTCDate(),
    14,
    56,
    tz
  );
}

/**
 * Monday 00:00:00.000 through Sunday 23:59:59.999, school-timezone wall
 * clock, of the week containing `flexDayDate` — as UTC instants.
 */
export function getSchoolWeekWindow(
  flexDayDate: Date,
  timeZone?: string
): {
  weekStart: Date;
  weekEnd: Date;
} {
  const tz = timeZone ?? schoolTimeZone();
  const year = flexDayDate.getUTCFullYear();
  const month = flexDayDate.getUTCMonth();
  const day = flexDayDate.getUTCDate();
  const dow = new Date(Date.UTC(year, month, day)).getUTCDay(); // 0=Sun..6=Sat
  const mondayOffset = dow === 0 ? -6 : 1 - dow;

  const monday = new Date(Date.UTC(year, month, day + mondayOffset));
  const sunday = new Date(Date.UTC(year, month, day + mondayOffset + 6));

  const weekStart = zonedTimeToUtc(
    monday.getUTCFullYear(),
    monday.getUTCMonth() + 1,
    monday.getUTCDate(),
    0,
    0,
    tz
  );
  const sundayStartOfLastMinute = zonedTimeToUtc(
    sunday.getUTCFullYear(),
    sunday.getUTCMonth() + 1,
    sunday.getUTCDate(),
    23,
    59,
    tz
  );
  const weekEnd = new Date(sundayStartOfLastMinute.getTime() + 59_999);

  return { weekStart, weekEnd };
}

/**
 * Check if the current time is past the signup deadline for a flex day.
 */
export function isPastSignupDeadline(
  flexDayDate: Date,
  timeZone?: string
): boolean {
  const deadline = getSignupDeadline(flexDayDate, timeZone);
  return new Date() > deadline;
}

/** How many days before a Flex Day a limited-window club opens for signups. */
export const LIMITED_SIGNUP_WINDOW_DAYS = 14;

/**
 * When signups open for a club with `limitedSignupWindow` set: 8:00 AM
 * school-local time, LIMITED_SIGNUP_WINDOW_DAYS calendar days before the
 * Flex Day. A fixed, announced moment keeps it first come, first served
 * without favouring whoever happens to be awake at midnight.
 */
export function getSignupOpensAt(flexDayDate: Date, timeZone?: string): Date {
  const tz = timeZone ?? schoolTimeZone();
  const opens = new Date(
    Date.UTC(
      flexDayDate.getUTCFullYear(),
      flexDayDate.getUTCMonth(),
      flexDayDate.getUTCDate() - LIMITED_SIGNUP_WINDOW_DAYS
    )
  );
  return zonedTimeToUtc(
    opens.getUTCFullYear(),
    opens.getUTCMonth() + 1,
    opens.getUTCDate(),
    8,
    0,
    tz
  );
}

/** True while a limited-window club's signups for this Flex Day are not open yet. */
export function isBeforeSignupOpens(
  flexDayDate: Date,
  timeZone?: string
): boolean {
  return new Date() < getSignupOpensAt(flexDayDate, timeZone);
}

/** e.g. "Mon, Oct 26 · 8:00 AM" — the opening moment as students should read it. */
export function formatSignupOpensAt(opensAt: Date, timeZone?: string): string {
  const tz = timeZone ?? schoolTimeZone();
  const date = opensAt.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: tz,
  });
  const time = opensAt.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  });
  return `${date} · ${time}`;
}
