import { describe, it, expect } from "vitest";
import {
  CSV_COLUMNS,
  PLACEHOLDER_GRADE_LEVEL,
  buildExportRows,
  exportFilename,
  studentIdFromEmail,
  toCsv,
  type ExportStudent,
} from "./csv-export";

const BOM = "﻿";

/** Rows of the rendered CSV, BOM and trailing newline stripped. */
function csvLines(csv: string): string[] {
  expect(csv.startsWith(BOM)).toBe(true);
  return csv.slice(BOM.length).replace(/\r\n$/, "").split("\r\n");
}

describe("studentIdFromEmail", () => {
  it("takes the local part of a school address", () => {
    expect(studentIdFromEmail("jdoe27@students.coderva.org")).toBe("jdoe27");
  });

  it("splits on the last @, not the first", () => {
    expect(studentIdFromEmail("odd@name@students.coderva.org")).toBe("odd@name");
  });

  it("returns the input unchanged when there is no @ at all", () => {
    expect(studentIdFromEmail("malformed")).toBe("malformed");
  });
});

describe("buildExportRows", () => {
  it("puts each rotation's club in its own column", () => {
    const students: ExportStudent[] = [
      {
        email: "jdoe27@students.coderva.org",
        signups: [
          { rotations: ["FLEX_1"], sessionName: "Chess Club" },
          { rotations: ["FLEX_2"], sessionName: "Robotics" },
          { rotations: ["FLEX_3"], sessionName: "Esports" },
        ],
      },
    ];

    expect(buildExportRows(students)).toEqual([
      {
        student_id: "jdoe27",
        email: "jdoe27@students.coderva.org",
        grade_level: PLACEHOLDER_GRADE_LEVEL,
        F1: "Chess Club",
        F2: "Robotics",
        F3: "Esports",
      },
    ]);
  });

  it("repeats the club name across every rotation of a linked session", () => {
    // The explicitly requested behaviour: one Esports session spanning all
    // three rotations still reads Esports, Esports, Esports — not one name
    // followed by two blanks.
    const rows = buildExportRows([
      {
        email: "a@students.coderva.org",
        signups: [
          { rotations: ["FLEX_1", "FLEX_2", "FLEX_3"], sessionName: "Esports" },
        ],
      },
    ]);

    expect(rows[0].F1).toBe("Esports");
    expect(rows[0].F2).toBe("Esports");
    expect(rows[0].F3).toBe("Esports");
  });

  it("repeats the name for a session spanning only some rotations", () => {
    const rows = buildExportRows([
      {
        email: "a@students.coderva.org",
        signups: [{ rotations: ["FLEX_2", "FLEX_3"], sessionName: "Robotics" }],
      },
    ]);

    expect(rows[0]).toMatchObject({ F1: "", F2: "Robotics", F3: "Robotics" });
  });

  it("leaves a rotation blank when the student booked nothing for it", () => {
    const rows = buildExportRows([
      {
        email: "a@students.coderva.org",
        signups: [{ rotations: ["FLEX_2"], sessionName: "Chess Club" }],
      },
    ]);

    expect(rows[0]).toMatchObject({ F1: "", F2: "Chess Club", F3: "" });
  });

  it("gives every student the placeholder grade level", () => {
    const rows = buildExportRows([
      { email: "a@students.coderva.org", signups: [] },
      { email: "b@students.coderva.org", signups: [] },
    ]);

    expect(rows.map((r) => r.grade_level)).toEqual(["9", "9"]);
  });

  it("preserves the order it was given", () => {
    const rows = buildExportRows([
      { email: "b@students.coderva.org", signups: [] },
      { email: "a@students.coderva.org", signups: [] },
    ]);

    expect(rows.map((r) => r.email)).toEqual([
      "b@students.coderva.org",
      "a@students.coderva.org",
    ]);
  });
});

describe("toCsv", () => {
  it("emits the required header in the required order", () => {
    expect(csvLines(toCsv([]))[0]).toBe("student_id,email,grade_level,F1,F2,F3");
    expect(CSV_COLUMNS).toEqual([
      "student_id",
      "email",
      "grade_level",
      "F1",
      "F2",
      "F3",
    ]);
  });

  it("renders a full row", () => {
    const csv = toCsv(
      buildExportRows([
        {
          email: "jdoe27@students.coderva.org",
          signups: [
            { rotations: ["FLEX_1", "FLEX_2", "FLEX_3"], sessionName: "Esports" },
          ],
        },
      ])
    );

    expect(csvLines(csv)[1]).toBe(
      "jdoe27,jdoe27@students.coderva.org,9,Esports,Esports,Esports"
    );
  });

  it("quotes a club name containing a comma", () => {
    // An unquoted comma shifts every later column, which in this file means
    // sending a student to the wrong room.
    const csv = toCsv(
      buildExportRows([
        {
          email: "a@students.coderva.org",
          signups: [{ rotations: ["FLEX_1"], sessionName: "Drama, Stage & Set" }],
        },
      ])
    );

    expect(csvLines(csv)[1]).toBe(
      'a,a@students.coderva.org,9,"Drama, Stage & Set",,'
    );
  });

  it("doubles embedded quotes", () => {
    const csv = toCsv(
      buildExportRows([
        {
          email: "a@students.coderva.org",
          signups: [{ rotations: ["FLEX_1"], sessionName: 'The "Best" Club' }],
        },
      ])
    );

    expect(csvLines(csv)[1]).toBe(
      'a,a@students.coderva.org,9,"The ""Best"" Club",,'
    );
  });

  it("quotes a value containing a newline without breaking the row count", () => {
    const csv = toCsv(
      buildExportRows([
        {
          email: "a@students.coderva.org",
          signups: [{ rotations: ["FLEX_1"], sessionName: "Line one\nLine two" }],
        },
      ])
    );

    // Records are CRLF-delimited, so the embedded bare \n stays inside the
    // quoted field rather than splitting the student across two rows.
    expect(csv).toContain('"Line one\nLine two"');
    expect(csvLines(csv)).toEqual([
      "student_id,email,grade_level,F1,F2,F3",
      'a,a@students.coderva.org,9,"Line one\nLine two",,',
    ]);
  });

  it("uses CRLF endings and a UTF-8 BOM so Excel reads it correctly", () => {
    const csv = toCsv(
      buildExportRows([{ email: "a@students.coderva.org", signups: [] }])
    );

    expect(csv.startsWith(BOM)).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv).toContain("\r\n");
  });

  it("produces a header-only file when nobody has signed up", () => {
    expect(csvLines(toCsv([]))).toEqual([
      "student_id,email,grade_level,F1,F2,F3",
    ]);
  });
});

describe("exportFilename", () => {
  it("names the file after the flex day's date", () => {
    expect(exportFilename(new Date("2026-09-09T00:00:00.000Z"))).toBe(
      "flex-day-2026-09-09-signups.csv"
    );
  });
});
