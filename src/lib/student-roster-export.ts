import type { RotationSlot } from "@prisma/client";
import { serializeCsv, studentIdFromEmail } from "@/lib/csv-export";

/**
 * Student roster export — the signup reconciliation file.
 *
 * The app has no roster of its own. A User row is created by NextAuth the first
 * time a student signs in with Google (src/auth.ts), so the app cannot know
 * about a student who has never logged in. That makes every "not signed up"
 * figure in the app blind to exactly the students most at risk of missing a Flex
 * Day: they are absent from the population those figures are computed over.
 *
 * This file closes that loop outside the app. An admin downloads it and diffs
 * the `email` column against the school's master student list; whoever is in the
 * master list and not in this file has never signed in at all, and needs
 * chasing. The signup columns then answer the second question from the same
 * file: who has signed in but not yet picked a club.
 *
 * Sibling of src/lib/csv-export.ts, and deliberately the inverse of it — that
 * export is driven from signups (a student with nothing booked has no row),
 * this one is driven from students (a student with nothing booked is the point).
 */
export const STUDENT_ROSTER_COLUMNS = [
  "name",
  "email",
  "student_id",
  "signed_up",
  "rotations_covered",
] as const;

export interface StudentRosterSignup {
  /** Rotations this signup covers. A linked session covers more than one. */
  rotations: RotationSlot[];
}

export interface StudentRosterStudent {
  name: string;
  email: string;
  /** Signups on the Flex Day being reported on. Empty when they have none. */
  signups: StudentRosterSignup[];
}

export interface StudentRosterRow {
  name: string;
  email: string;
  student_id: string;
  signed_up: string;
  rotations_covered: string;
}

/**
 * Distinct rotations a student is placed in, 0–3.
 *
 * A *set*, not a count of signups. A linked session covers several rotations in
 * one row, so counting signups would report a student booked solid for all three
 * rotations as "1" — the same conflation of sessions with rotations that
 * src/lib/participation.ts exists to warn about.
 */
function rotationsCovered(signups: StudentRosterSignup[]): number {
  const covered = new Set<RotationSlot>();
  for (const signup of signups) {
    for (const rotation of signup.rotations) covered.add(rotation);
  }
  return covered.size;
}

/**
 * One row per student, ordered with whoever needs chasing at the top.
 *
 * `hasFlexDay` is false when there is no upcoming active Flex Day. Both signup
 * columns then render blank rather than "no": there is no day to have signed up
 * for, and a column of "no" would tell the spreadsheet on the other end to email
 * the entire school about a Flex Day that does not exist. Blank is the honest
 * answer to a question that has not been asked yet.
 *
 * Sort order is unsigned-up first (this file is a to-do list, so the work goes
 * at the top), then name, then email. The email tiebreak is what makes two
 * downloads of an unchanged roster identical, and therefore diffable.
 */
export function buildStudentRosterRows(
  students: StudentRosterStudent[],
  { hasFlexDay }: { hasFlexDay: boolean }
): StudentRosterRow[] {
  return students
    .map((student) => {
      const covered = rotationsCovered(student.signups);
      const isSignedUp = student.signups.length > 0;

      return {
        student,
        isSignedUp,
        row: {
          name: student.name,
          email: student.email,
          student_id: studentIdFromEmail(student.email),
          signed_up: hasFlexDay ? (isSignedUp ? "yes" : "no") : "",
          rotations_covered: hasFlexDay ? String(covered) : "",
        },
      };
    })
    .sort((a, b) => {
      if (a.isSignedUp !== b.isSignedUp) return a.isSignedUp ? 1 : -1;
      return (
        a.student.name.localeCompare(b.student.name) ||
        a.student.email.localeCompare(b.student.email)
      );
    })
    .map((entry) => entry.row);
}

/** Serialize student roster rows. */
export function toStudentRosterCsv(rows: StudentRosterRow[]): string {
  return serializeCsv(STUDENT_ROSTER_COLUMNS, rows);
}

/**
 * e.g. "students-2026-09-09.csv", or "students.csv" when the export is not
 * reporting against any Flex Day — the name has to say which day the signup
 * columns refer to, because a file full of "no" means nothing without it.
 */
export function studentRosterFilename(flexDayDate: Date | null): string {
  if (!flexDayDate) return "students.csv";
  return `students-${flexDayDate.toISOString().slice(0, 10)}.csv`;
}
