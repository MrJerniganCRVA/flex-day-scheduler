import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * env() memoizes, so each case re-imports the module to get a fresh parse.
 */
async function loadEnv(overrides: Record<string, string | undefined>) {
  vi.resetModules();
  const base: Record<string, string> = {
    DATABASE_URL: "postgresql://u:p@localhost:5432/db",
    AUTH_SECRET: "a-secret",
    AUTH_GOOGLE_ID: "client-id",
    AUTH_GOOGLE_SECRET: "client-secret",
    GOOGLE_SERVICE_ACCOUNT_EMAIL: "svc@project.iam.gserviceaccount.com",
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY:
      "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----",
    ALLOWED_EMAIL_DOMAIN: "school.org",
    SCHOOL_TIMEZONE: "America/New_York",
    FLEX_1_START: "09:00",
    FLEX_1_END: "09:50",
    FLEX_2_START: "10:00",
    FLEX_2_END: "10:50",
    FLEX_3_START: "11:00",
    FLEX_3_END: "11:50",
  };

  for (const [k, v] of Object.entries({ ...base, ...overrides })) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }

  const mod = await import("./env");
  return mod;
}

const ORIGINAL = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL };
});

describe("env", () => {
  it("accepts a fully configured environment", async () => {
    const { env } = await loadEnv({});
    expect(env().SCHOOL_TIMEZONE).toBe("America/New_York");
    expect(env().FLEX_2_START).toBe("10:00");
  });

  it("rejects a leading @ on the email domain", async () => {
    // The silent-lockout trap: the sign-in check builds `@${domain}`, so
    // "@school.org" becomes "@@school.org" and matches nobody. Previously this
    // rejected every login with only a console.log to show for it.
    const { env } = await loadEnv({ ALLOWED_EMAIL_DOMAIN: "@school.org" });
    expect(() => env()).toThrow(/must not start with "@"/);
  });

  it("rejects a missing email domain", async () => {
    const { env } = await loadEnv({ ALLOWED_EMAIL_DOMAIN: undefined });
    expect(() => env()).toThrow(/ALLOWED_EMAIL_DOMAIN/);
  });

  it("rejects an unresolvable timezone", async () => {
    const { env } = await loadEnv({ SCHOOL_TIMEZONE: "America/Nowhere" });
    expect(() => env()).toThrow(/valid IANA timezone/);
  });

  it("rejects a malformed bell time", async () => {
    const { env } = await loadEnv({ FLEX_1_START: "9am" });
    expect(() => env()).toThrow(/FLEX_1_START/);
  });

  it("rejects an out-of-range bell time", async () => {
    const { env } = await loadEnv({ FLEX_2_END: "25:00" });
    expect(() => env()).toThrow(/FLEX_2_END/);
  });

  it("rejects a rotation that ends before it starts", async () => {
    // Google accepts such an event and renders it nonsensically.
    const { env } = await loadEnv({
      FLEX_3_START: "11:50",
      FLEX_3_END: "11:00",
    });
    expect(() => env()).toThrow(/must be later than/);
  });

  it("rejects a private key that isn't a PEM block", async () => {
    const { env } = await loadEnv({
      GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: "not-a-key",
    });
    expect(() => env()).toThrow(/PEM key/);
  });

  it("reports every problem at once rather than only the first", async () => {
    const { env } = await loadEnv({
      ALLOWED_EMAIL_DOMAIN: undefined,
      SCHOOL_TIMEZONE: "Mars/Olympus",
      FLEX_1_START: "nope",
    });
    let message = "";
    try {
      env();
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/ALLOWED_EMAIL_DOMAIN/);
    expect(message).toMatch(/SCHOOL_TIMEZONE/);
    expect(message).toMatch(/FLEX_1_START/);
  });

  it("does not require the optional URL and seed values", async () => {
    const { env } = await loadEnv({
      AUTH_URL: undefined,
      NEXTAUTH_URL: undefined,
      SEED_ADMIN_EMAIL: undefined,
    });
    expect(() => env()).not.toThrow();
  });

  it("memoizes, so repeated calls return the same object", async () => {
    const { env } = await loadEnv({});
    expect(env()).toBe(env());
  });
});
