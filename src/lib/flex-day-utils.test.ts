import { describe, it, expect } from "vitest";
import {
  getSignupDeadline,
  getSchoolWeekWindow,
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
