import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  formatCountdown,
  startDeadlineCountdown,
  CLOSED,
} from "./signup-countdown";

/**
 * The first test below is the regression that matters. Before the extraction
 * this logic lived inline in FlexDaySignupView's useEffect, where the expiry
 * branch of the first synchronous tick read the `const` holding the interval
 * handle one line before it was initialized:
 *
 *   ReferenceError: Cannot access 'id' before initialization
 *
 * minified in production to "Cannot access 't' before initialization". It fired
 * for every student whose nearest Flex Day had already closed — i.e. every
 * student, every week, from Friday 2:56 PM until the next open Flex Day — and
 * took the whole student dashboard down with it right after they signed in.
 *
 * Fake timers drive both Date.now and setInterval, so these exercise the real
 * scheduling rather than an injected clock.
 */

const AT = new Date("2026-09-15T12:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AT);
});

afterEach(() => {
  vi.useRealTimers();
});

const inMs = (ms: number) => new Date(AT.getTime() + ms);

describe("startDeadlineCountdown", () => {
  it("does not throw when the deadline has already passed on arrival", () => {
    const onExpired = vi.fn();
    const onTick = vi.fn();

    expect(() =>
      startDeadlineCountdown({
        deadline: inMs(-60_000),
        onTick,
        onExpired,
      })
    ).not.toThrow();

    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(onTick).not.toHaveBeenCalled();
  });

  it("starts no interval at all for a deadline that has already passed", () => {
    const onExpired = vi.fn();

    startDeadlineCountdown({
      deadline: inMs(-1),
      onTick: vi.fn(),
      onExpired,
    });

    // A timer left running here would keep firing onExpired forever.
    vi.advanceTimersByTime(10_000);
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports immediately, then once a second, while the deadline is open", () => {
    const onTick = vi.fn();

    startDeadlineCountdown({
      deadline: inMs(10_000),
      onTick,
      onExpired: vi.fn(),
    });

    expect(onTick).toHaveBeenCalledTimes(1);
    expect(onTick).toHaveBeenLastCalledWith({
      text: "Closes in 0m 10s",
      urgency: "urgent",
    });

    vi.advanceTimersByTime(3_000);
    expect(onTick).toHaveBeenCalledTimes(4);
    expect(onTick).toHaveBeenLastCalledWith({
      text: "Closes in 0m 7s",
      urgency: "urgent",
    });
  });

  it("expires exactly once when the deadline passes mid-countdown, and stops", () => {
    const onExpired = vi.fn();
    const onTick = vi.fn();

    startDeadlineCountdown({
      deadline: inMs(2_500),
      onTick,
      onExpired,
    });

    vi.advanceTimersByTime(10_000);
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);

    const ticksAtExpiry = onTick.mock.calls.length;
    vi.advanceTimersByTime(10_000);
    expect(onTick).toHaveBeenCalledTimes(ticksAtExpiry);
  });

  it("stops reporting once cleaned up", () => {
    const onTick = vi.fn();

    const stop = startDeadlineCountdown({
      deadline: inMs(60_000),
      onTick,
      onExpired: vi.fn(),
    });

    vi.advanceTimersByTime(2_000);
    const before = onTick.mock.calls.length;

    stop();
    vi.advanceTimersByTime(5_000);

    expect(onTick).toHaveBeenCalledTimes(before);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("survives a cleanup called twice", () => {
    const stop = startDeadlineCountdown({
      deadline: inMs(60_000),
      onTick: vi.fn(),
      onExpired: vi.fn(),
    });

    stop();
    expect(() => stop()).not.toThrow();
  });
});

describe("formatCountdown", () => {
  it("reports closed at or below zero", () => {
    expect(formatCountdown(0)).toEqual(CLOSED);
    expect(formatCountdown(-1)).toEqual(CLOSED);
  });

  it("is urgent under five minutes", () => {
    expect(formatCountdown(4 * 60_000 + 59_000)).toEqual({
      text: "Closes in 4m 59s",
      urgency: "urgent",
    });
  });

  it("is a warning from five minutes to an hour", () => {
    expect(formatCountdown(5 * 60_000)).toEqual({
      text: "Closes in 5m 0s",
      urgency: "warning",
    });
    expect(formatCountdown(59 * 60_000 + 59_000)).toEqual({
      text: "Closes in 59m 59s",
      urgency: "warning",
    });
  });

  it("switches to hours and minutes at an hour", () => {
    expect(formatCountdown(60 * 60_000)).toEqual({
      text: "Closes in 1h 0m",
      urgency: "normal",
    });
  });

  it("switches to days and hours at a day", () => {
    expect(formatCountdown(24 * 3600_000)).toEqual({
      text: "Closes in 1d 0h",
      urgency: "normal",
    });
    expect(formatCountdown(3 * 24 * 3600_000 + 4 * 3600_000)).toEqual({
      text: "Closes in 3d 4h",
      urgency: "normal",
    });
  });
});
