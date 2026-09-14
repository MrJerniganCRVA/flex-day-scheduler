import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Covers only the base-URL resolution — the part of this module that decides
 * where a teacher's browser is sent, and the part that got the Railway
 * deployment wrong. Everything else here talks to Google or the database.
 *
 * google-oauth.ts imports prisma, which builds a real client at module load, and
 * googleapis, which is large and irrelevant to this logic. Both are stubbed so
 * the suite stays what vitest.config.mts says it is: no database, no network.
 */
vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("googleapis", () => ({
  google: { auth: { OAuth2: class {} }, calendar: () => ({}) },
}));

/** `warnOnceAboutInternalOrigin` keeps module state, so each case re-imports. */
async function load(vars: Record<string, string | undefined>) {
  vi.resetModules();
  for (const key of ["AUTH_URL", "NEXTAUTH_URL"]) {
    const value = vars[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return import("./google-oauth");
}

const ORIGINAL = { ...process.env };

/** What a Next.js route handler sees inside a Railway container. */
const CONTAINER_ORIGIN = "https://localhost:8080";
const PUBLIC_URL = "https://flexday.up.railway.app";

beforeEach(() => {
  process.env = { ...ORIGINAL };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("appBaseUrl", () => {
  it("prefers AUTH_URL over both NEXTAUTH_URL and the request origin", async () => {
    const { appBaseUrl } = await load({
      AUTH_URL: PUBLIC_URL,
      NEXTAUTH_URL: "https://stale.example.org",
    });
    expect(appBaseUrl(CONTAINER_ORIGIN)).toBe(PUBLIC_URL);
  });

  it("falls back to NEXTAUTH_URL when AUTH_URL is unset", async () => {
    const { appBaseUrl } = await load({ NEXTAUTH_URL: PUBLIC_URL });
    expect(appBaseUrl(CONTAINER_ORIGIN)).toBe(PUBLIC_URL);
  });

  it("ignores an AUTH_URL that exists but is blank", async () => {
    // `AUTH_URL ?? NEXTAUTH_URL` would return "" here — not nullish — and drop
    // the deployment to its container origin with NEXTAUTH_URL sitting right
    // there, correctly set.
    const { appBaseUrl } = await load({
      AUTH_URL: "   ",
      NEXTAUTH_URL: PUBLIC_URL,
    });
    expect(appBaseUrl(CONTAINER_ORIGIN)).toBe(PUBLIC_URL);
  });

  it("trims surrounding whitespace off a configured value", async () => {
    const { appBaseUrl } = await load({ NEXTAUTH_URL: `  ${PUBLIC_URL}  ` });
    expect(appBaseUrl(CONTAINER_ORIGIN)).toBe(PUBLIC_URL);
  });

  it("uses the request origin only when neither variable is set", async () => {
    const { appBaseUrl } = await load({});
    expect(appBaseUrl("https://flexday.example.org")).toBe(
      "https://flexday.example.org"
    );
  });

  it("warns once when it falls back to a loopback origin", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { appBaseUrl } = await load({});

    expect(appBaseUrl(CONTAINER_ORIGIN)).toBe(CONTAINER_ORIGIN);
    appBaseUrl(CONTAINER_ORIGIN);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("NEXTAUTH_URL");
  });

  it("falls back to the request origin when the configured value is unparseable", async () => {
    // Callers build URLs on this, including the callback's own error path — a
    // value that throws there would leave the teacher on a Next.js error page
    // instead of their dashboard.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { appBaseUrl } = await load({ NEXTAUTH_URL: "not a url" });

    expect(appBaseUrl(CONTAINER_ORIGIN)).toBe(CONTAINER_ORIGIN);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(() => new URL("/teacher", appBaseUrl(CONTAINER_ORIGIN))).not.toThrow();
  });

  it("rejects a scheme-less configured value rather than building on it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { appBaseUrl } = await load({ NEXTAUTH_URL: "flexday.up.railway.app" });

    expect(appBaseUrl(CONTAINER_ORIGIN)).toBe(CONTAINER_ORIGIN);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("stays quiet when the request origin is a real public host", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { appBaseUrl } = await load({});

    appBaseUrl("https://flexday.example.org");

    expect(warn).not.toHaveBeenCalled();
  });
});

describe("calendarRedirectUri", () => {
  it("builds the callback off the configured URL, not the container origin", async () => {
    // The string Google matches byte-for-byte against its registered list. A
    // container origin leaking in here is a redirect_uri_mismatch.
    const { calendarRedirectUri } = await load({ NEXTAUTH_URL: PUBLIC_URL });
    expect(calendarRedirectUri(CONTAINER_ORIGIN)).toBe(
      `${PUBLIC_URL}/api/calendar/callback`
    );
  });

  it("does not double the slash when the configured URL has a trailing one", async () => {
    const { calendarRedirectUri } = await load({
      NEXTAUTH_URL: `${PUBLIC_URL}/`,
    });
    expect(calendarRedirectUri(CONTAINER_ORIGIN)).toBe(
      `${PUBLIC_URL}/api/calendar/callback`
    );
  });
});
