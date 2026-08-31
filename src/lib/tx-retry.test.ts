import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { conflictBackoffMs, isSerializationConflict } from "./tx-retry";

/** The shape Prisma produces when it maps a conflict hit during a query. */
function knownRequestError(code: string) {
  return new Prisma.PrismaClientKnownRequestError("conflict", {
    code,
    clientVersion: "7.4.0",
  });
}

/**
 * The shape `@prisma/adapter-pg` produces when the conflict is only detected at
 * COMMIT. DriverAdapterError isn't exported from any public entry point, so
 * this reconstructs what was observed against a real Postgres: an Error with
 * that name and "TransactionWriteConflict" as its message.
 */
function driverAdapterError(message: string) {
  const error = new Error(message);
  error.name = "DriverAdapterError";
  return error;
}

describe("isSerializationConflict", () => {
  it("recognises the mapped P2034 shape", () => {
    expect(isSerializationConflict(knownRequestError("P2034"))).toBe(true);
  });

  it("recognises the unmapped commit-time driver adapter shape", () => {
    // This is the case the old `error.code === "P2034"` check missed, which
    // turned a retryable conflict into an HTTP 500 for the student.
    expect(
      isSerializationConflict(driverAdapterError("TransactionWriteConflict"))
    ).toBe(true);
  });

  it("recognises a raw Postgres serialization-failure SQLSTATE", () => {
    const error = Object.assign(new Error("could not serialize access"), {
      code: "40001",
    });
    expect(isSerializationConflict(error)).toBe(true);
  });

  it("does not treat a unique-constraint violation as retryable", () => {
    expect(isSerializationConflict(knownRequestError("P2002"))).toBe(false);
  });

  it("does not treat a record-not-found error as retryable", () => {
    expect(isSerializationConflict(knownRequestError("P2025"))).toBe(false);
  });

  it("does not treat an unrelated driver adapter error as retryable", () => {
    expect(
      isSerializationConflict(driverAdapterError("ConnectionClosed"))
    ).toBe(false);
  });

  it("does not treat the app's own thrown control-flow errors as retryable", () => {
    // The signup route throws these to unwind the transaction; retrying them
    // would silently repeat a rejection the caller should see once.
    for (const message of [
      "CAPACITY_FULL",
      "ROTATION_CONFLICT",
      "SIGNUPS_CLOSED",
      "SESSION_NOT_FOUND",
    ]) {
      expect(isSerializationConflict(new Error(message))).toBe(false);
    }
  });

  it("handles non-Error values without throwing", () => {
    for (const value of [null, undefined, "P2034", 42, {}]) {
      expect(isSerializationConflict(value)).toBe(false);
    }
  });
});

describe("conflictBackoffMs", () => {
  it("grows with each attempt", () => {
    // Randomised, so compare the floors rather than exact values.
    expect(conflictBackoffMs(1)).toBeLessThan(conflictBackoffMs(4));
  });

  it("stays within a bound a waiting student would tolerate", () => {
    for (let attempt = 1; attempt <= 4; attempt++) {
      const delay = conflictBackoffMs(attempt);
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThan(500);
    }
  });

  it("jitters, so conflicting requests do not all retry in lockstep", () => {
    const samples = new Set(
      Array.from({ length: 20 }, () => conflictBackoffMs(3))
    );
    expect(samples.size).toBeGreaterThan(1);
  });
});
