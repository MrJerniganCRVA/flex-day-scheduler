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

/**
 * Calculate the signup deadline for a given flex day.
 * Deadline is Friday before the flex day at 2:56 PM school-local time.
 *
 * `timeZone` defaults to the configured school timezone; it is a parameter so
 * the DST behavior can be tested against fixed zones without env setup.
 */
export function getSignupDeadline(flexDayDate: Date, timeZone?: string): Date {
  const tz = timeZone ?? schoolTimeZone();
  const flexDay = new Date(flexDayDate);

  // Day-of-week / day-offset arithmetic operates purely on the calendar date
  // (dates are stored as UTC midnight in the DB) and is timezone-independent,
  // so it stays in UTC.
  const year = flexDay.getUTCFullYear();
  const month = flexDay.getUTCMonth();
  const day = flexDay.getUTCDate();
  const dayOfWeek = new Date(Date.UTC(year, month, day)).getUTCDay();

  // Calculate days back to the most recent Friday (5 = Friday)
  let daysBack: number;
  if (dayOfWeek === 0) {
    // Sunday -> go back 2 days to Friday
    daysBack = 2;
  } else if (dayOfWeek === 6) {
    // Saturday -> go back 1 day to Friday
    daysBack = 1;
  } else {
    // Monday-Friday -> go back to previous Friday
    // Mon(1)=3, Tue(2)=4, Wed(3)=5, Thu(4)=6, Fri(5)=7
    daysBack = dayOfWeek + 2;
  }

  const deadlineDate = new Date(Date.UTC(year, month, day - daysBack));

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
