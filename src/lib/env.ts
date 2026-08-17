import { z } from "zod";

/**
 * Validated environment configuration.
 *
 * Every consumer of `process.env` in this app used to read it inline with a
 * `?? fallback`, which meant a missing or malformed value degraded silently
 * into wrong behavior rather than an error:
 *
 *  - A typo'd `ALLOWED_EMAIL_DOMAIN` rejected *every* login, visible only as a
 *    server-side console.log while users saw the login page again.
 *  - Missing `FLEX_*` times fell back to the placeholder bell times from
 *    .env.example, so real calendar invites went out to students at 9:00.
 *  - A missing `SCHOOL_TIMEZONE` silently shifted every signup deadline.
 *
 * Validation is **lazy and memoized** rather than run at import. `next build`
 * imports this module while tracing the module graph, and a build machine
 * legitimately may not hold runtime secrets — throwing there would break
 * deploys for the wrong reason. Instead, `assertEnv()` is called explicitly at
 * container start from scripts/db-init.ts, so misconfiguration fails the boot
 * loudly, and any request that slips past that still fails with this same
 * message rather than a silent wrong answer.
 */

const TIME_24H = /^([01]\d|2[0-3]):[0-5]\d$/;

const REQUIRED = (name: string) => `${name} is required`;

function isResolvableTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** "09:00" -> 540, for ordering comparisons. */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

const timeField = (name: string) =>
  z
    .string({ error: `${name} is required (24h "HH:MM", e.g. "09:00")` })
    .min(1)
    .regex(TIME_24H, `${name} must be 24-hour "HH:MM" (e.g. "09:00", "14:30")`);

const envSchema = z
  .object({
    DATABASE_URL: z.string({ error: REQUIRED("DATABASE_URL") }).min(1),

    AUTH_SECRET: z
      .string({
        error:
          "AUTH_SECRET is required — generate one with: openssl rand -base64 32",
      })
      .min(1),

    AUTH_GOOGLE_ID: z.string({ error: REQUIRED("AUTH_GOOGLE_ID") }).min(1),
    AUTH_GOOGLE_SECRET: z.string({ error: REQUIRED("AUTH_GOOGLE_SECRET") }).min(1),

    GOOGLE_SERVICE_ACCOUNT_EMAIL: z
      .string({
        error:
          "GOOGLE_SERVICE_ACCOUNT_EMAIL is required — without it no calendar invites can be sent",
      })
      .min(1)
      .email("GOOGLE_SERVICE_ACCOUNT_EMAIL must be an email address"),

    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: z
      .string({
        error:
          "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY is required — without it no calendar invites can be sent",
      })
      .min(1)
      .refine(
        (v) => v.includes("PRIVATE KEY"),
        'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY does not look like a PEM key — it should contain "-----BEGIN ... PRIVATE KEY-----" (with literal newlines replaced by \\n)'
      ),

    // A leading "@" here is the silent-lockout trap: the sign-in check builds
    // `@${domain}`, so "@school.org" becomes "@@school.org" and matches nobody.
    ALLOWED_EMAIL_DOMAIN: z
      .string({
        error:
          'ALLOWED_EMAIL_DOMAIN is required (e.g. "school.org") — nobody can sign in without it',
      })
      .min(1)
      .refine(
        (v) => !v.startsWith("@"),
        'ALLOWED_EMAIL_DOMAIN must not start with "@" — use "school.org", not "@school.org". A leading @ silently rejects every login.'
      )
      .refine(
        (v) => v.includes("."),
        'ALLOWED_EMAIL_DOMAIN should be a full domain (e.g. "school.org")'
      ),

    SCHOOL_TIMEZONE: z
      .string({
        error:
          'SCHOOL_TIMEZONE is required (IANA name, e.g. "America/New_York") — it sets every signup deadline',
      })
      .min(1)
      .refine(
        isResolvableTimeZone,
        'SCHOOL_TIMEZONE must be a valid IANA timezone name (e.g. "America/New_York")'
      ),

    FLEX_1_START: timeField("FLEX_1_START"),
    FLEX_1_END: timeField("FLEX_1_END"),
    FLEX_2_START: timeField("FLEX_2_START"),
    FLEX_2_END: timeField("FLEX_2_END"),
    FLEX_3_START: timeField("FLEX_3_START"),
    FLEX_3_END: timeField("FLEX_3_END"),

    // Optional: Auth.js infers the URL from request headers (trustHost: true).
    AUTH_URL: z.string().optional(),
    NEXTAUTH_URL: z.string().optional(),

    // Optional: scripts/db-init.ts skips the admin seed when absent.
    SEED_ADMIN_EMAIL: z.string().email().optional().or(z.literal("")),
  })
  // A transposed start/end pair would produce calendar events that end before
  // they begin, which Google accepts and renders nonsensically.
  .superRefine((cfg, ctx) => {
    for (const n of [1, 2, 3] as const) {
      const start = cfg[`FLEX_${n}_START`];
      const end = cfg[`FLEX_${n}_END`];
      if (toMinutes(start) >= toMinutes(end)) {
        ctx.addIssue({
          code: "custom",
          path: [`FLEX_${n}_END`],
          message: `FLEX_${n}_END (${end}) must be later than FLEX_${n}_START (${start})`,
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

function formatIssues(error: z.ZodError): string {
  const lines = error.issues.map((i) => {
    const key = i.path.join(".");
    return `  • ${key ? `${key}: ` : ""}${i.message}`;
  });
  return [
    "Invalid environment configuration:",
    ...lines,
    "",
    "See .env.example for the full list of required values.",
  ].join("\n");
}

/**
 * Parse and memoize the environment. Throws with every problem listed at once,
 * rather than failing on the first one and hiding the rest.
 */
export function env(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(formatIssues(parsed.error));
  }
  cached = parsed.data;
  return cached;
}

/**
 * Eager check for startup. Called from scripts/db-init.ts before the server
 * starts so a misconfigured deploy fails at boot with a readable message
 * instead of serving a subtly wrong schedule.
 */
export function assertEnv(): void {
  env();
}
