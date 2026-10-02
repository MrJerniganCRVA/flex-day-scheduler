import { describe, it, expect, vi, afterEach } from "vitest";
import { formatFlexDayDate, startOfTodayUtc } from "./flex-day-date";

describe("formatFlexDayDate", () => {
  // A @db.Date comes back as UTC midnight. Read in a zone west of UTC it
  // would be the previous evening, so the label must not move with the viewer.
  const day = new Date("2026-10-02T00:00:00.000Z");

  it("reads the long form in UTC", () => {
    expect(formatFlexDayDate(day)).toBe("Friday, October 2, 2026");
  });

  it("reads the short form in UTC", () => {
    expect(formatFlexDayDate(day, "short")).toBe("Fri, Oct 2, 2026");
  });

  it("accepts the ISO string a client component receives", () => {
    expect(formatFlexDayDate(day.toISOString())).toBe("Friday, October 2, 2026");
  });
});

describe("startOfTodayUtc", () => {
  afterEach(() => vi.useRealTimers());

  it("is midnight UTC of the current UTC day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-02T23:59:00.000Z"));
    expect(startOfTodayUtc().toISOString()).toBe("2026-10-02T00:00:00.000Z");
  });
});
