/**
 * Who is allowed in, and what they are.
 *
 * The rule is small — `@students.<domain>` is a student, `@<domain>` is staff,
 * anything else is nobody — but it is the rule that decides both who may sign in
 * and what role they get, and it was written out by hand twice inside
 * src/auth.ts before this file existed.
 *
 * It now has a third caller: the CSV student import
 * (src/lib/student-import.ts). An import that accepted an address login would
 * reject would create a User row nobody can ever sign in to, and one that
 * accepted a staff address as a STUDENT would have that row silently promoted to
 * TEACHER by the session callback at their next login. Both are only avoidable
 * if import and login agree, and they can only be relied on to agree if the rule
 * exists exactly once.
 *
 * The classifier takes the domain as an argument rather than reading it, so it
 * stays a pure function that tests can exercise without environment setup.
 * `allowedEmailDomain()` is the thin wrapper that supplies the configured value.
 */

export type EmailKind =
  /** @students.<domain> — signs in as a STUDENT. */
  | "student"
  /** @<domain> — signs in and is promoted to TEACHER. */
  | "teacher"
  /** Anything else. Rejected at login, rejected at import. */
  | "outside";

/**
 * The school's domain, e.g. "school.org".
 *
 * Read straight from `process.env` rather than through `env()`, matching
 * src/auth.ts: the auth callbacks run on every request and must not be the place
 * where an unrelated missing variable (a bell time, a service-account key) first
 * throws. An absent domain yields "", which `classifyEmail` treats as "let
 * nobody in" — the same fail-closed behavior the sign-in callback already has.
 */
export function allowedEmailDomain(): string {
  return process.env.ALLOWED_EMAIL_DOMAIN ?? "";
}

/**
 * Which side of the domain an address falls on.
 *
 * Order matters: `@students.school.org` also ends with `@school.org`-ish text,
 * so the student suffix has to be tested first and staff defined as "the domain,
 * but not the student subdomain". Getting that backwards would make every
 * student a teacher.
 */
export function classifyEmail(email: string, domain: string): EmailKind {
  const normalized = email.trim().toLowerCase();
  if (!normalized || !domain) return "outside";

  if (normalized.endsWith(`@students.${domain}`)) return "student";
  if (normalized.endsWith(`@${domain}`)) return "teacher";
  return "outside";
}

/** Convenience for callers that just want the configured domain applied. */
export function classifyAllowedEmail(email: string): EmailKind {
  return classifyEmail(email, allowedEmailDomain());
}

/**
 * A placeholder display name derived from the address: "jane.doe" -> "Jane Doe".
 *
 * Used only by the CSV import, and only when the file carries no name for a
 * student. It is a stand-in, not a guess at their real name — a roster full of
 * raw email addresses is unreadable to the admin using it, and the real name
 * arrives the moment the student first signs in, when the `linkAccount` event in
 * src/auth.ts writes their Google profile name over this.
 *
 * Separators are split on rather than stripped so "jane.doe", "jane_doe" and
 * "jane-doe" all land in the same place. A local part with no separator at all
 * ("jdoe27") simply comes back capitalized, which is the honest result.
 */
export function nameFromEmail(email: string): string {
  const at = email.lastIndexOf("@");
  const local = (at === -1 ? email : email.slice(0, at)).trim();
  if (!local) return email.trim();

  const words = local
    .split(/[._\-+]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());

  return words.length > 0 ? words.join(" ") : local;
}
