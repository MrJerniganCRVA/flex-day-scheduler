import { describe, it, expect } from "vitest";
import {
  STUDENT_ROSTER_COLUMNS,
  buildStudentRosterRows,
  studentRosterFilename,
  toStudentRosterCsv,
  type StudentRosterStudent,
} from "./student-roster-export";

const BOM = "﻿";

const HEADER = "name,email,student_id,signed_up,rotations_covered";

/** Rows of the rendered CSV, BOM and trailing newline stripped. */
function csvLines(csv: string): string[] {
  expect(csv.startsWith(BOM)).toBe(true);
  return csv.slice(BOM.length).replace(/\r\n$/, "").split("\r\n");
}

/** A student with no signups on the day being reported on. */
function student(
  name: string,
  email: string,
  signups: StudentRosterStudent["signups"] = []
): StudentRosterStudent {
  return { name, email, signups };
}

const WITH_DAY = { hasFlexDay: true };

describe("buildStudentRosterRows", () => {
  it("gives a student with no signups a row saying so", () => {
    const [row] = buildStudentRosterRows(
      [student("Jane Doe", "jdoe27@students.coderva.org")],
      WITH_DAY
    );

    expect(row).toEqual({
      name: "Jane Doe",
      email: "jdoe27@students.coderva.org",
      student_id: "jdoe27",
      signed_up: "no",
      rotations_covered: "0",
    });
  });

  it("counts every rotation of a linked session", () => {
    const [row] = buildStudentRosterRows(
      [
        student("Jane Doe", "jdoe27@students.coderva.org", [
          { rotations: ["FLEX_1", "FLEX_2", "FLEX_3"] },
        ]),
      ],
      WITH_DAY
    );

    expect(row.signed_up).toBe("yes");
    expect(row.rotations_covered).toBe("3");
  });

  it("counts distinct rotations across signups, not signups", () => {
    const [row] = buildStudentRosterRows(
      [
        student("Jane Doe", "jdoe27@students.coderva.org", [
          { rotations: ["FLEX_1", "FLEX_2"] },
          { rotations: ["FLEX_2", "FLEX_3"] },
        ]),
      ],
      WITH_DAY
    );

    // Two signups covering four rotation slots, but only three real rotations.
    expect(row.rotations_covered).toBe("3");
  });

  it("counts a student as signed up even when their session has no rotations", () => {
    const [row] = buildStudentRosterRows(
      [student("Jane Doe", "jdoe27@students.coderva.org", [{ rotations: [] }])],
      WITH_DAY
    );

    // They have chosen something; the placement is what's incomplete. Reporting
    // "no" would put them on the chase list alongside students who never
    // touched the app.
    expect(row.signed_up).toBe("yes");
    expect(row.rotations_covered).toBe("0");
  });

  it("leaves both signup columns blank when there is no Flex Day", () => {
    const rows = buildStudentRosterRows(
      [student("Jane Doe", "jdoe27@students.coderva.org")],
      { hasFlexDay: false }
    );

    // Not "no": there is no day to have signed up for, and "no" would tell the
    // spreadsheet to chase the entire school.
    expect(rows[0].signed_up).toBe("");
    expect(rows[0].rotations_covered).toBe("");
  });

  it("puts students who have not signed up first, then sorts by name", () => {
    const rows = buildStudentRosterRows(
      [
        student("Alice Adams", "aadams@students.coderva.org", [
          { rotations: ["FLEX_1"] },
        ]),
        student("Zoe Zhang", "zzhang@students.coderva.org"),
        student("Bob Brown", "bbrown@students.coderva.org", [
          { rotations: ["FLEX_1"] },
        ]),
        student("Carl Cole", "ccole@students.coderva.org"),
      ],
      WITH_DAY
    );

    expect(rows.map((r) => r.name)).toEqual([
      "Carl Cole",
      "Zoe Zhang",
      "Alice Adams",
      "Bob Brown",
    ]);
  });

  it("breaks name ties on email so repeat downloads are identical", () => {
    const rows = buildStudentRosterRows(
      [
        student("Jane Doe", "jdoe28@students.coderva.org"),
        student("Jane Doe", "jdoe27@students.coderva.org"),
      ],
      WITH_DAY
    );

    expect(rows.map((r) => r.email)).toEqual([
      "jdoe27@students.coderva.org",
      "jdoe28@students.coderva.org",
    ]);
  });
});

describe("toStudentRosterCsv", () => {
  it("writes the header in the declared column order", () => {
    expect(csvLines(toStudentRosterCsv([]))).toEqual([HEADER]);
    expect(STUDENT_ROSTER_COLUMNS.join(",")).toBe(HEADER);
  });

  it("quotes a name containing a comma", () => {
    const rows = buildStudentRosterRows(
      [student("Doe, Jane", "jdoe27@students.coderva.org")],
      WITH_DAY
    );

    expect(csvLines(toStudentRosterCsv(rows))).toEqual([
      HEADER,
      '"Doe, Jane",jdoe27@students.coderva.org,jdoe27,no,0',
    ]);
  });

  it("uses CRLF endings and a UTF-8 BOM so Excel reads it correctly", () => {
    const csv = toStudentRosterCsv(
      buildStudentRosterRows(
        [student("Jane Doe", "jdoe27@students.coderva.org")],
        WITH_DAY
      )
    );

    expect(csv.startsWith(BOM)).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
  });
});

describe("studentRosterFilename", () => {
  it("names the file after the Flex Day the signup columns describe", () => {
    expect(studentRosterFilename(new Date("2026-09-09T00:00:00.000Z"))).toBe(
      "students-2026-09-09.csv"
    );
  });

  it("drops the date when there is no Flex Day to report against", () => {
    expect(studentRosterFilename(null)).toBe("students.csv");
  });
});
