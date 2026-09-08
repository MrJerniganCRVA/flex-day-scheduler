import { describe, it, expect } from "vitest";
import {
  getSignupDeadline,
  getSignupOpenTime,
  getSchoolWeekWindow,
  isBeforeSignupOpen,
  isPastSignupDeadline,
} from "./flex-day-utils";

/**
 * These functions do hand-rolled DST-aware timezone conversion. An hour of drift
 * here silently locks students out early or lets them sign up after the cutoff,
 * and nothing surfaces the mistake until someone complains — so the expectations
 * below are written as absolute UTC instants derived by hand, not by running the
 * code and recording what it printed.
 *
 * Reference points for America/New_York in 2026:
 *   EST = UTC-5, EDT = UTC-4
 *   DST starts Sun 8 Mar 2026, ends Sun 1 Nov 2026
 *
 * A timezone is passed explicitly throughout, so these tests need no
 * environment configuration.
 */

const NY = "America/New_York";
const LA = "America/Los_Angeles";

/** Flex-day dates are stored as DATE columns, i.e. UTC midnight. */
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("getSignupDeadline", () => {
  it("resolves to 2:56 PM Eastern Daylight Time in summer", () => {
    // Wed 19 Aug 2026 -> Fri 14 Aug 2026, 14:56 EDT (UTC-4) = 18:56Z
    expect(getSignupDeadline(day("2026-08-19"), NY).toISOString()).toBe(
      "2026-08-14T18:56:00.000Z"
    );
  });

  it("resolves to 2:56 PM Eastern Standard Time in winter", () => {
    // Wed 21 Jan 2026 -> Fri 16 Jan 2026, 14:56 EST (UTC-5) = 19:56Z
    expect(getSignupDeadline(day("2026-01-21"), NY).toISOString()).toBe(
      "2026-01-16T19:56:00.000Z"
    );
  });

  it("uses standard time when the flex day is in DST but its deadline is not", () => {
    // DST starts Sun 8 Mar 2026. Wed 11 Mar is EDT, but its deadline falls on
    // Fri 6 Mar, still EST — so the correct offset is UTC-5, not UTC-4. Reading
    // the offset from the flex day instead of the deadline would be an hour off.
    expect(getSignupDeadline(day("2026-03-11"), NY).toISOString()).toBe(
      "2026-03-06T19:56:00.000Z"
    );
  });

  it("uses daylight time when the flex day is past the fall-back but its deadline is not", () => {
    // DST ends Sun 1 Nov 2026. Wed 4 Nov is EST, deadline Fri 30 Oct is EDT.
    expect(getSignupDeadline(day("2026-11-04"), NY).toISOString()).toBe(
      "2026-10-30T18:56:00.000Z"
    );
  });

  it("honors a timezone other than Eastern", () => {
    // 14:56 PDT (UTC-7) = 21:56Z
    expect(getSignupDeadline(day("2026-08-19"), LA).toISOString()).toBe(
      "2026-08-14T21:56:00.000Z"
    );
  });

  it("gives every day from Saturday through the next Friday the same deadline", () => {
    // The whole Sat..Fri span closes at the Friday that precedes the Saturday,
    // which exercises the Sunday (dayOfWeek 0) and Saturday (6) branches
    // alongside the weekday arithmetic.
    const span = [
      "2026-08-15", // Sat
      "2026-08-16", // Sun
      "2026-08-17", // Mon
      "2026-08-18", // Tue
      "2026-08-19", // Wed
      "2026-08-20", // Thu
      "2026-08-21", // Fri
    ];
    const deadlines = span.map((d) =>
      getSignupDeadline(day(d), NY).toISOString()
    );
    expect(new Set(deadlines).size).toBe(1);
    expect(deadlines[0]).toBe("2026-08-14T18:56:00.000Z");
  });

  it("lands on a Friday for every day of the week", () => {
    for (let offset = 0; offset < 7; offset++) {
      const d = new Date(Date.UTC(2026, 7, 15 + offset));
      const deadline = getSignupDeadline(d, NY);
      // 14:56 Eastern is the same calendar day in UTC, so getUTCDay is safe here.
      expect(deadline.getUTCDay()).toBe(5);
      expect(deadline.getTime()).toBeLessThan(d.getTime());
    }
  });
});

describe("isPastSignupDeadline", () => {
  it("is true for a flex day well in the past", () => {
    expect(isPastSignupDeadline(day("2020-01-08"), NY)).toBe(true);
  });

  it("is false for a flex day well in the future", () => {
    expect(isPastSignupDeadline(day("2099-01-07"), NY)).toBe(false);
  });
});

describe("getSignupOpenTime", () => {
  /** Weekday as read in a given zone — 00:00 school-local is the previous
   *  calendar day in UTC for any zone east of Greenwich, so getUTCDay would
   *  quietly pass only for the Americas. */
  const weekdayIn = (d: Date, tz: string) =>
    new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(d);

  it("opens at midnight Eastern Daylight Time in summer", () => {
    // Wed 19 Aug 2026 -> its week begins Mon 17 Aug -> back one week to
    // Mon 10 Aug, 00:00 EDT (UTC-4) = 04:00Z.
    expect(getSignupOpenTime(day("2026-08-19"), NY).toISOString()).toBe(
      "2026-08-10T04:00:00.000Z"
    );
  });

  it("opens at midnight Eastern Standard Time in winter", () => {
    // Wed 21 Jan 2026 -> Mon 19 Jan -> Mon 12 Jan, 00:00 EST (UTC-5) = 05:00Z.
    expect(getSignupOpenTime(day("2026-01-21"), NY).toISOString()).toBe(
      "2026-01-12T05:00:00.000Z"
    );
  });

  it("uses standard time when the flex day is in DST but its opening is not", () => {
    // DST starts Sun 8 Mar 2026. Wed 11 Mar is EDT, but signups opened on
    // Mon 2 Mar, still EST — UTC-5, not UTC-4.
    expect(getSignupOpenTime(day("2026-03-11"), NY).toISOString()).toBe(
      "2026-03-02T05:00:00.000Z"
    );
  });

  it("uses daylight time when the flex day is past the fall-back but its opening is not", () => {
    // DST ends Sun 1 Nov 2026. Wed 4 Nov is EST, Mon 26 Oct is EDT.
    expect(getSignupOpenTime(day("2026-11-04"), NY).toISOString()).toBe(
      "2026-10-26T04:00:00.000Z"
    );
  });

  it("honors a timezone other than Eastern", () => {
    // Mon 10 Aug 2026, 00:00 PDT (UTC-7) = 07:00Z.
    expect(getSignupOpenTime(day("2026-08-19"), LA).toISOString()).toBe(
      "2026-08-10T07:00:00.000Z"
    );
  });

  it("gives every day of one week the same opening time", () => {
    // Mon..Sun of the week beginning 17 Aug all open on Mon 10 Aug. Covers the
    // Sunday branch (dayOfWeek 0), which belongs to the week that *started* the
    // previous Monday rather than the one it begins.
    const span = [
      "2026-08-17", // Mon
      "2026-08-18", // Tue
      "2026-08-19", // Wed
      "2026-08-20", // Thu
      "2026-08-21", // Fri
      "2026-08-22", // Sat
      "2026-08-23", // Sun
    ];
    const opens = span.map((d) => getSignupOpenTime(day(d), NY).toISOString());
    expect(new Set(opens).size).toBe(1);
    expect(opens[0]).toBe("2026-08-10T04:00:00.000Z");
  });

  it("lands on a Monday for every day of the week", () => {
    for (let offset = 0; offset < 7; offset++) {
      const d = new Date(Date.UTC(2026, 7, 17 + offset));
      expect(weekdayIn(getSignupOpenTime(d, NY), NY)).toBe("Monday");
    }
  });

  it("opens before it closes, in the same week as the deadline", () => {
    for (const d of ["2026-01-21", "2026-03-11", "2026-08-19", "2026-11-04"]) {
      const opensAt = getSignupOpenTime(day(d), NY);
      const deadline = getSignupDeadline(day(d), NY);
      expect(opensAt.getTime()).toBeLessThan(deadline.getTime());
      // The window is one school week: Monday 00:00 to Friday 14:56, four days
      // and change apart.
      const days = (deadline.getTime() - opensAt.getTime()) / 86_400_000;
      expect(days).toBeGreaterThan(4);
      expect(days).toBeLessThan(5);
    }
  });
});

describe("isBeforeSignupOpen", () => {
  it("is true for a flex day well in the future", () => {
    expect(isBeforeSignupOpen(day("2099-01-07"), NY)).toBe(true);
  });

  it("is false for a flex day well in the past", () => {
    expect(isBeforeSignupOpen(day("2020-01-08"), NY)).toBe(false);
  });
});

describe("getSchoolWeekWindow", () => {
  it("spans Monday 00:00 to Sunday 23:59:59.999 school-local", () => {
    const { weekStart, weekEnd } = getSchoolWeekWindow(day("2026-08-19"), NY);
    // Mon 17 Aug 00:00 EDT = 04:00Z
    expect(weekStart.toISOString()).toBe("2026-08-17T04:00:00.000Z");
    // Sun 23 Aug 23:59:59.999 EDT = Mon 24 Aug 03:59:59.999Z
    expect(weekEnd.toISOString()).toBe("2026-08-24T03:59:59.999Z");
  });

  it("treats Sunday as the end of its week, not the start", () => {
    // Sun 16 Aug belongs to the week beginning Mon 10 Aug.
    const { weekStart, weekEnd } = getSchoolWeekWindow(day("2026-08-16"), NY);
    expect(weekStart.toISOString()).toBe("2026-08-10T04:00:00.000Z");
    expect(weekEnd.toISOString()).toBe("2026-08-17T03:59:59.999Z");
  });

  it("contains the flex day it was derived from", () => {
    for (const d of ["2026-01-21", "2026-03-11", "2026-08-19", "2026-11-04"]) {
      const { weekStart, weekEnd } = getSchoolWeekWindow(day(d), NY);
      expect(weekStart.getTime()).toBeLessThan(day(d).getTime());
      expect(weekEnd.getTime()).toBeGreaterThan(day(d).getTime());
    }
  });

  it("covers a week containing a DST transition without gaps", () => {
    // DST starts Sun 8 Mar 2026, the last day of the week beginning Mon 2 Mar.
    // That week is 167 hours long, not 168.
    const { weekStart, weekEnd } = getSchoolWeekWindow(day("2026-03-04"), NY);
    const hours = (weekEnd.getTime() - weekStart.getTime()) / 3_600_000;
    expect(hours).toBeCloseTo(167, 2);
  });
});
