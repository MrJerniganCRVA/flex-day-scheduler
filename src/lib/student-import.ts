import { classifyEmail, nameFromEmail } from "@/lib/email-domain";

/**
 * Student roster import — the other half of the reconciliation loop.
 *
 * src/lib/student-roster-export.ts exists because the app cannot see a student
 * who has never signed in: a User row is created by NextAuth at first login, so
 * the students least likely to be scheduled are exactly the ones missing from
 * every figure the app computes. That export hands an admin a file to diff
 * against the school's master list. It answers "who is missing"; it has no way
 * to do anything about them.
 *
 * This module is the answer. It reads a CSV of students back in, so the admin
 * can add the missing rows and upload the same file. Once a User row exists,
 * every downstream feature already works on it unchanged — auto-assign selects
 * on `role: STUDENT`, and finalize invites `signup.student.email` — so creating
 * the row is the entire intervention.
 *
 * Deliberately pure: no Prisma, no environment. The domain is passed in, which
 * keeps every rule here testable against a fixed domain and leaves the database
 * work to the route (src/app/api/admin/students/import/route.ts).
 */

/** Why a row was not imported. Each one is reported back with its line number. */
export type RowProblem =
  /** The row had no value in the email column. */
  | "no-email"
  /** Something is there, but it is not an email address. */
  | "invalid-email"
  /** A real address, but not at the school's domain — it could never sign in. */
  | "wrong-domain"
  /** A staff address. Importing it as a STUDENT would mis-role a teacher. */
  | "teacher-email"
  /** The same address appeared on an earlier line of this same file. */
  | "duplicate-in-file";

export interface ParsedStudent {
  /** Lowercased. User.email is unique and auth compares lowercased. */
  email: string;
  name: string;
  /** 1-based line in the uploaded file, for reporting problems back. */
  line: number;
}

export interface RejectedRow {
  line: number;
  /** What was on that line, so the admin can find it in their spreadsheet. */
  raw: string;
  reason: RowProblem;
}

export interface ParsedImport {
  students: ParsedStudent[];
  rejected: RejectedRow[];
}

/**
 * Header names accepted for each column, lowercased.
 *
 * "name" and "email" are what src/lib/student-roster-export.ts writes, so the
 * app's own export round-trips without editing. The rest are the spellings a
 * student-information-system export tends to use, since the other likely source
 * of this file is an SIS download that nobody should have to reformat by hand.
 */
const EMAIL_HEADERS = new Set([
  "email",
  "email address",
  "email_address",
  "e-mail",
  "student email",
  "student_email",
  "mail",
]);
const NAME_HEADERS = new Set([
  "name",
  "student name",
  "student_name",
  "full name",
  "full_name",
  "display name",
  "displayname",
]);

/**
 * Deliberately loose. This is a format check, not an attempt to decide whether
 * an address can receive mail — `classifyEmail` does the decision that matters
 * by insisting on the school's own domain, and anything that passes that is an
 * address the school issued.
 */
const EMAIL_SHAPE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

/**
 * Read CSV text into rows of fields, per RFC 4180.
 *
 * The exact inverse of `escapeField` in src/lib/csv-export.ts, and it has to be:
 * this app writes club names like "Drama, Stage & Set" into the file it expects
 * to read back, and a reader that split on commas would turn one such row into
 * two and shift every column after it.
 *
 * Handles quoted fields, "" as an escaped quote, newlines inside quotes, and
 * both CRLF and LF endings. The leading UTF-8 BOM is stripped because
 * `serializeCsv` writes one (for Excel's benefit) and it would otherwise become
 * part of the first header name, so the app's own export would fail to match its
 * own "name" column.
 */
export function parseCsvRows(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\r") {
      // Swallow the LF of a CRLF pair; a lone CR still ends the row.
      if (input[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  // Trailing field, unless the file ended on a row terminator with nothing after
  // it — a file ending in a newline must not yield a phantom empty last row.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/** Column positions. `name` is -1 when the file carries no name column. */
interface Columns {
  email: number;
  name: number;
}

/**
 * Locate the email and name columns from a header row.
 *
 * Returns null when the first row is not a header at all — a bare list of
 * addresses is a perfectly reasonable thing for an admin to paste into a file,
 * and refusing it over a missing header would be pedantry. The caller falls back
 * to sniffing in that case.
 */
function readHeader(cells: string[]): Columns | null {
  const normalized = cells.map((c) => c.trim().toLowerCase());
  const email = normalized.findIndex((c) => EMAIL_HEADERS.has(c));
  if (email === -1) return null;

  return {
    email,
    name: normalized.findIndex((c) => NAME_HEADERS.has(c)),
  };
}

/** The first cell in a row that looks like an email address. */
function sniffEmailColumn(rows: string[][]): number {
  for (const row of rows) {
    const index = row.findIndex((cell) => EMAIL_SHAPE.test(cell.trim()));
    if (index !== -1) return index;
  }
  return 0;
}

/**
 * Parse an uploaded student CSV.
 *
 * Extra columns are ignored rather than rejected, which is what makes the
 * intended workflow work: the admin downloads the export (whose columns are
 * name, email, student_id, signed_up, rotations_covered), adds the missing
 * students to the bottom of it, and uploads the same file back without deleting
 * anything.
 *
 * Rows that cannot be imported are returned alongside the ones that can, not
 * thrown. A file of two thousand students with three malformed lines should
 * import one thousand nine hundred and ninety-seven of them and tell the admin
 * about the three — failing the whole upload would send them hunting through a
 * spreadsheet with no indication of where to look.
 */
export function parseStudentCsv(text: string, domain: string): ParsedImport {
  const rows = parseCsvRows(text);
  const students: ParsedStudent[] = [];
  const rejected: RejectedRow[] = [];

  if (rows.length === 0) return { students, rejected };

  const header = readHeader(rows[0]);
  const columns: Columns = header ?? {
    email: sniffEmailColumn(rows),
    name: -1,
  };
  // Only skip the first row when it really was a header. Sniffing means the
  // first row is data, and dropping it would silently lose a student.
  const firstDataRow = header ? 1 : 0;

  // Keyed by email so a repeat is caught wherever it appears in the file, which
  // is what a hand-edited export tends to contain — the admin pastes in a block
  // from the master list that overlaps what was already there.
  const seen = new Map<string, number>();

  for (let i = firstDataRow; i < rows.length; i++) {
    const cells = rows[i];
    const line = i + 1;

    // Blank lines are ordinary in a hand-edited file, and are not a problem
    // worth reporting.
    if (cells.every((cell) => cell.trim() === "")) continue;

    const raw = cells.join(",");
    const email = (cells[columns.email] ?? "").trim().toLowerCase();

    if (!email) {
      rejected.push({ line, raw, reason: "no-email" });
      continue;
    }
    if (!EMAIL_SHAPE.test(email)) {
      rejected.push({ line, raw, reason: "invalid-email" });
      continue;
    }

    // The import must accept exactly what login accepts. A row that fails here
    // would become a User row nobody could ever sign in to, and a staff address
    // imported as a STUDENT would be promoted to TEACHER by the session callback
    // at their next login. See src/lib/email-domain.ts.
    const kind = classifyEmail(email, domain);
    if (kind === "teacher") {
      rejected.push({ line, raw, reason: "teacher-email" });
      continue;
    }
    if (kind === "outside") {
      rejected.push({ line, raw, reason: "wrong-domain" });
      continue;
    }

    if (seen.has(email)) {
      rejected.push({ line, raw, reason: "duplicate-in-file" });
      continue;
    }
    seen.set(email, line);

    const given = columns.name === -1 ? "" : (cells[columns.name] ?? "").trim();

    students.push({
      email,
      // A name column that is present but empty is the common case in an SIS
      // export, so fall back rather than storing a blank — User.name is
      // non-nullable, and a roster of empty cells helps nobody.
      name: given || nameFromEmail(email),
      line,
    });
  }

  return { students, rejected };
}
