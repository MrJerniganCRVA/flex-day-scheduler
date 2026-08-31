import type { RotationSlot } from "@prisma/client";

/**
 * Flex Day roster export.
 *
 * This is the paper backup: if the app is down on a Flex Day morning, this file
 * is what tells staff which student is in which room for each rotation. It is
 * therefore deliberately dumb and self-contained — one row per student, one
 * column per rotation, no lookups needed to read it.
 *
 * Column order is fixed and must not be rearranged; downstream tooling reads it
 * positionally.
 */
export const CSV_COLUMNS = [
  "student_id",
  "email",
  "grade_level",
  "F1",
  "F2",
  "F3",
] as const;

/** Rotation slot behind each of the F1/F2/F3 columns, in column order. */
const ROTATION_COLUMNS: RotationSlot[] = ["FLEX_1", "FLEX_2", "FLEX_3"];

/**
 * Grade level for every student.
 *
 * The app has never held a grade level — accounts come from Google sign-in,
 * which carries only name and email. A constant 9 is a deliberate placeholder:
 * the column has to be present and populated for the invite tooling that
 * consumes this file, and a uniform value is honest about the fact that the
 * real grade isn't known here, where a blank column would silently break that
 * tooling. Replace this with a real per-student value once the app has one.
 */
export const PLACEHOLDER_GRADE_LEVEL = "9";

export interface ExportSignup {
  /** Rotations this signup covers. A linked session covers more than one. */
  rotations: RotationSlot[];
  /** Club name, or the session's own title for a one-off session. */
  sessionName: string;
}

export interface ExportStudent {
  email: string;
  signups: ExportSignup[];
}

export interface ExportRow {
  student_id: string;
  email: string;
  grade_level: string;
  F1: string;
  F2: string;
  F3: string;
}

/**
 * Student identifier: the local part of the school email address.
 *
 * The app stores no separate student number, and the internal cuid is
 * meaningless outside this database — it could not be matched against a class
 * roster or an SIS export, which is the whole point of the file. The local part
 * is stable, unique (User.email is unique), and is what school systems key on.
 */
export function studentIdFromEmail(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1 ? email : email.slice(0, at);
}

/**
 * One row per student, with each rotation column carrying the name of whatever
 * they are in for that rotation.
 *
 * A session spanning several rotations fills each of them with the same name —
 * a student in Esports for all three reads "Esports,Esports,Esports", not one
 * name and two blanks. That repetition is intentional: the file is read a row
 * at a time by someone directing students, and a blank has to mean "nothing
 * scheduled" rather than "look left".
 */
export function buildExportRows(students: ExportStudent[]): ExportRow[] {
  return students.map((student) => {
    const byRotation = new Map<RotationSlot, string>();
    for (const signup of student.signups) {
      for (const rotation of signup.rotations) {
        byRotation.set(rotation, signup.sessionName);
      }
    }

    const [f1, f2, f3] = ROTATION_COLUMNS.map((r) => byRotation.get(r) ?? "");

    return {
      student_id: studentIdFromEmail(student.email),
      email: student.email,
      grade_level: PLACEHOLDER_GRADE_LEVEL,
      F1: f1,
      F2: f2,
      F3: f3,
    };
  });
}

/**
 * Quote one field per RFC 4180.
 *
 * Club names are free text typed by teachers, so commas, quotes and newlines
 * all really do occur ("Drama, Stage & Set"). An unquoted comma silently shifts
 * every later column in that row, which in this file means putting a student in
 * the wrong room.
 */
function escapeField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Serialize rows to CSV text.
 *
 * CRLF line endings per RFC 4180, and a UTF-8 BOM so Excel on Windows opens the
 * file as UTF-8 instead of mangling any non-ASCII name in it. Both are for the
 * benefit of the spreadsheet this is going to be opened in.
 */
export function toCsv(rows: ExportRow[]): string {
  const lines = [
    CSV_COLUMNS.join(","),
    ...rows.map((row) =>
      CSV_COLUMNS.map((column) => escapeField(row[column])).join(",")
    ),
  ];
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** e.g. "flex-day-2026-09-09-signups.csv" */
export function exportFilename(flexDayDate: Date): string {
  const date = flexDayDate.toISOString().slice(0, 10);
  return `flex-day-${date}-signups.csv`;
}
