/**
 * The signup deadline countdown, as pure logic.
 *
 * Extracted from src/components/student/FlexDaySignupView.tsx, where it was an
 * inline `useEffect` — and where it carried a crash that reached students:
 *
 *   Uncaught ReferenceError: Cannot access 't' before initialization
 *
 * The effect called its own `tick()` once, synchronously, *before* the
 * `const id = setInterval(...)` on the following line had initialized. Whenever
 * the deadline had already passed, that first call took the expiry branch and
 * ran `clearInterval(id)` while `id` was still in its temporal dead zone. So the
 * student dashboard — the page every student lands on after signing in — threw
 * during hydration for the whole stretch between one Friday 2:56 PM deadline and
 * the next Flex Day, and Next.js replaced the page with "A client side exception
 * has occurred".
 *
 * It lives here rather than in the component because the test suite is
 * `src/**` + `*.test.ts` on the node environment — no browser, no React — so a
 * timer buried in an effect was untestable by construction. See
 * signup-countdown.test.ts for the regression that pins the expired-on-arrival
 * case.
 */

export type CountdownUrgency = "normal" | "warning" | "urgent";

export interface Countdown {
  text: string;
  urgency: CountdownUrgency;
}

/** What a student is shown once the deadline has passed. */
export const CLOSED: Countdown = { text: "Signups closed", urgency: "urgent" };

export function formatCountdown(msRemaining: number): Countdown {
  if (msRemaining <= 0) return CLOSED;

  const totalSeconds = Math.floor(msRemaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (totalSeconds < 300) {
    return { text: `Closes in ${minutes}m ${seconds}s`, urgency: "urgent" };
  }
  if (totalSeconds < 3600) {
    return { text: `Closes in ${minutes}m ${seconds}s`, urgency: "warning" };
  }
  if (totalSeconds < 86400) {
    return { text: `Closes in ${hours}h ${minutes}m`, urgency: "normal" };
  }
  return { text: `Closes in ${days}d ${hours}h`, urgency: "normal" };
}

/**
 * Report the time left until `deadline`, once immediately and then every second,
 * until it expires or the returned cleanup is called.
 *
 * `onExpired` fires at most once, and no interval is left running after it — a
 * deadline that has already passed when this is called starts no timer at all,
 * which is both the common case on the student dashboard and the case that used
 * to crash.
 *
 * The handle is declared before `tick` so it is never read from its temporal
 * dead zone, and `stopped` is what lets the very first call suppress the
 * interval that has not been created yet. Reversing the order instead — start
 * the interval, then tick — would trade the crash for a timer that ticks on
 * forever against an expired deadline.
 */
export function startDeadlineCountdown(params: {
  deadline: Date;
  onTick: (countdown: Countdown) => void;
  onExpired: () => void;
}): () => void {
  const { deadline, onTick, onExpired } = params;

  let id: ReturnType<typeof setInterval> | undefined;
  let stopped = false;

  const stop = () => {
    stopped = true;
    if (id !== undefined) {
      clearInterval(id);
      id = undefined;
    }
  };

  const tick = () => {
    const msRemaining = deadline.getTime() - Date.now();
    if (msRemaining <= 0) {
      onExpired();
      stop();
      return;
    }
    onTick(formatCountdown(msRemaining));
  };

  tick();
  if (!stopped) id = setInterval(tick, 1000);

  return stop;
}
