/**
 * How a Flex Day's date is read and shown.
 *
 * Kept free of env and Prisma imports so client components can use it too.
 * FlexDay.date is a @db.Date, which Prisma reads back as UTC midnight, so every
 * comparison and every label here works in UTC. Formatting in the viewer's
 * zone would show the previous day to anyone west of UTC.
 */

/** Midnight UTC today: the lower bound for every "upcoming days" query. */
export function startOfTodayUtc(): Date {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return today;
}

const FORMATS = {
  /** "Friday, October 2, 2026" — page headings. */
  long: { weekday: "long", month: "long", day: "numeric", year: "numeric" },
  /** "Fri, Oct 2, 2026" — lists and pickers. */
  short: { weekday: "short", month: "short", day: "numeric", year: "numeric" },
} satisfies Record<string, Intl.DateTimeFormatOptions>;

/** A Flex Day's date as a label, read in UTC. */
export function formatFlexDayDate(
  date: Date | string,
  style: keyof typeof FORMATS = "long"
): string {
  return new Date(date).toLocaleDateString("en-US", {
    ...FORMATS[style],
    timeZone: "UTC",
  });
}
