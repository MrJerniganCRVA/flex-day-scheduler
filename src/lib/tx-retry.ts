import { Prisma } from "@prisma/client";

/**
 * Recognise a Postgres serialization failure (SQLSTATE 40001) coming back out
 * of a Serializable `prisma.$transaction`.
 *
 * Three endpoints run check-then-write logic at Serializable isolation and
 * retry the loser of a conflict: POST /api/signups, POST /api/admin/roster,
 * and the auto-assign commit. All three used to test for
 * `PrismaClientKnownRequestError` with code P2034 and nothing else — which
 * catches only *half* the conflicts.
 *
 * Under Prisma 7 with the `@prisma/adapter-pg` driver adapter the same
 * serialization failure surfaces in two different shapes depending on when
 * Postgres notices it:
 *
 *  - Detected while a query inside the transaction runs → the driver error is
 *    mapped to `PrismaClientKnownRequestError` with code `P2034`.
 *  - Detected at COMMIT (very common for SSI: the predicate read that made the
 *    transaction unsafe only conflicts once the other side commits) → the
 *    COMMIT is issued by the transaction machinery rather than by a user
 *    query, so it escapes unmapped as a `DriverAdapterError` whose message is
 *    `TransactionWriteConflict`.
 *
 * The second shape matched neither the retry test nor any of the handled
 * error messages, so it fell through to `throw error` and became an HTTP 500.
 * Measured against a real Postgres: five students signing up for one club
 * simultaneously produced three 500s. That is precisely the launch-day
 * scenario — a whole class opening the same popular club at once — so the
 * miss would have been at its worst on the first day.
 *
 * Matching on the message string is unpleasant but it is the only marker the
 * adapter exposes; `DriverAdapterError` is not exported from any public entry
 * point and carries no code. The P2034 branch stays first so the mapped shape
 * never depends on the string.
 */
export function isSerializationConflict(error: unknown): boolean {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  ) {
    return true;
  }

  if (!(error instanceof Error)) return false;

  // Unmapped driver-adapter error from a failed COMMIT.
  if (
    error.name === "DriverAdapterError" &&
    error.message.includes("TransactionWriteConflict")
  ) {
    return true;
  }

  // Belt and braces: the raw Postgres serialization-failure SQLSTATE, in case
  // a future adapter version passes the pg error through directly.
  const code = (error as { code?: unknown }).code;
  return code === "40001";
}

/** Retry attempts for a Serializable transaction before giving up. */
export const MAX_TX_ATTEMPTS = 5;

/**
 * Backoff before retrying attempt `attempt` (1-based) of a conflicting
 * transaction.
 *
 * Retrying immediately is what the previous code did, and it makes contention
 * worse: every loser of a conflict re-reads at once and collides again. A
 * short randomised backoff spreads them out. Kept small — a student is waiting
 * on this request — so the worst case adds well under a second.
 */
export function conflictBackoffMs(attempt: number): number {
  const base = 15 * 2 ** (attempt - 1); // 15, 30, 60, 120 ms
  return base + Math.random() * base;
}

/** Sleep helper, extracted so tests can assert on the backoff without waiting. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
