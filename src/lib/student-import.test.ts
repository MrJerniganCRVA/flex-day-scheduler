import { describe, it, expect } from "vitest";
import { parseCsvRows, parseStudentCsv } from "./student-import";
import { toStudentRosterCsv, buildStudentRosterRows } from "./student-roster-export";

const DOMAIN = "coderva.org";

/** Parse against the school domain the rest of the suite uses. */
function parse(csv: string) {
  return parseStudentCsv(csv, DOMAIN);
}

describe("parseCsvRows", () => {
  it("reads plain comma-separated rows", () => {
    expect(parseCsvRows("a,b\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("reads CRLF as well as LF", () => {
    expect(parseCsvRows("a,b\r\nc,d\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  // The inverse of escapeField in csv-export.ts. A reader that split on commas
  // would turn "Drama, Stage & Set" into two fields and shift every column
  // after it.
  it("keeps a comma inside a quoted field", () => {
    expect(parseCsvRows('a,"Drama, Stage & Set",c')).toEqual([
      ["a", "Drama, Stage & Set", "c"],
    ]);
  });

  it('reads "" as an escaped quote', () => {
    expect(parseCsvRows('a,"She said ""hi""",c')).toEqual([
      ["a", 'She said "hi"', "c"],
    ]);
  });

  it("keeps a newline inside a quoted field", () => {
    expect(parseCsvRows('a,"line one\nline two"')).toEqual([
      ["a", "line one\nline two"],
    ]);
  });

  it("does not invent a row after a trailing newline", () => {
    expect(parseCsvRows("a,b\n")).toEqual([["a", "b"]]);
  });

  // serializeCsv writes a BOM for Excel's benefit. Left in place it becomes
  // part of the first header name, so the app's own export stops matching its
  // own "name" column.
  it("strips a leading UTF-8 BOM", () => {
    expect(parseCsvRows("\uFEFFname,email")).toEqual([["name", "email"]]);
  });

  it("returns nothing for empty input", () => {
    expect(parseCsvRows("")).toEqual([]);
  });
});

describe("parseStudentCsv", () => {
  it("reads name and email by header, ignoring other columns", () => {
    const { students, rejected } = parse(
      [
        "name,email,student_id,signed_up,rotations_covered",
        "Jane Doe,jdoe27@students.coderva.org,jdoe27,no,0",
      ].join("\r\n")
    );

    expect(rejected).toEqual([]);
    expect(students).toEqual([
      { name: "Jane Doe", email: "jdoe27@students.coderva.org", line: 2 },
    ]);
  });

  it("finds the columns whatever order they are in", () => {
    const { students } = parse(
      "student_id,Email Address,Full Name\njdoe27,jdoe27@students.coderva.org,Jane Doe"
    );
    expect(students[0]).toMatchObject({
      email: "jdoe27@students.coderva.org",
      name: "Jane Doe",
    });
  });

  // The workflow this feature exists for: download the export, add the missing
  // students to the bottom of it, upload the same file back.
  it("round-trips the app's own student export", () => {
    const csv = toStudentRosterCsv(
      buildStudentRosterRows(
        [
          { name: "Jane Doe", email: "jdoe27@students.coderva.org", signups: [] },
          { name: "Ann Ng", email: "ang31@students.coderva.org", signups: [] },
        ],
        { hasFlexDay: true }
      )
    );

    const { students, rejected } = parse(csv);

    expect(rejected).toEqual([]);
    expect(students.map((s) => s.email)).toEqual([
      "ang31@students.coderva.org",
      "jdoe27@students.coderva.org",
    ]);
    expect(students.map((s) => s.name)).toEqual(["Ann Ng", "Jane Doe"]);
  });

  it("accepts a bare list of addresses with no header", () => {
    const { students, rejected } = parse(
      "jdoe27@students.coderva.org\nang31@students.coderva.org"
    );

    expect(rejected).toEqual([]);
    expect(students.map((s) => s.email)).toEqual([
      "jdoe27@students.coderva.org",
      "ang31@students.coderva.org",
    ]);
  });

  // Sniffing means row one is data. Treating it as a header would silently
  // drop a student.
  it("does not swallow the first student when there is no header", () => {
    const { students } = parse("jdoe27@students.coderva.org");
    expect(students).toHaveLength(1);
  });

  it("derives a name when the column is missing or blank", () => {
    const { students } = parse(
      [
        "name,email",
        ",jane.doe@students.coderva.org",
        "  ,jdoe27@students.coderva.org",
      ].join("\n")
    );

    expect(students.map((s) => s.name)).toEqual(["Jane Doe", "Jdoe27"]);
  });

  it("lowercases and trims addresses", () => {
    const { students } = parse("email\n  JDoe27@Students.CodeRVA.org  ");
    expect(students[0].email).toBe("jdoe27@students.coderva.org");
  });

  it("skips blank lines without reporting them", () => {
    const { students, rejected } = parse(
      "email\n\njdoe27@students.coderva.org\n\n\nang31@students.coderva.org\n"
    );

    expect(rejected).toEqual([]);
    expect(students).toHaveLength(2);
  });

  it("rejects an address outside the school's domain", () => {
    const { students, rejected } = parse("email\njdoe27@gmail.com");

    expect(students).toEqual([]);
    expect(rejected).toEqual([
      { line: 2, raw: "jdoe27@gmail.com", reason: "wrong-domain" },
    ]);
  });

  // A staff address imported as a STUDENT would be promoted to TEACHER by the
  // session callback at their next login — a silent mis-role.
  it("rejects a staff address rather than importing a teacher as a student", () => {
    const { students, rejected } = parse("email\nmjernigan@coderva.org");

    expect(students).toEqual([]);
    expect(rejected[0].reason).toBe("teacher-email");
  });

  it("rejects a row with no address and one that is not an address", () => {
    const { students, rejected } = parse(
      "name,email\nJane Doe,\nAnn Ng,not-an-email"
    );

    expect(students).toEqual([]);
    expect(rejected.map((r) => r.reason)).toEqual(["no-email", "invalid-email"]);
  });

  it("keeps the first of a repeated address and reports the rest", () => {
    const { students, rejected } = parse(
      [
        "name,email",
        "Jane Doe,jdoe27@students.coderva.org",
        "Ann Ng,ang31@students.coderva.org",
        "Jane D,JDOE27@students.coderva.org",
      ].join("\n")
    );

    expect(students.map((s) => s.name)).toEqual(["Jane Doe", "Ann Ng"]);
    expect(rejected).toEqual([
      {
        line: 4,
        raw: "Jane D,JDOE27@students.coderva.org",
        reason: "duplicate-in-file",
      },
    ]);
  });

  // One bad line must not cost the admin the other 1,999 students.
  it("imports the good rows alongside the bad ones", () => {
    const { students, rejected } = parse(
      [
        "name,email",
        "Jane Doe,jdoe27@students.coderva.org",
        "Nobody,junk",
        "Ann Ng,ang31@students.coderva.org",
      ].join("\n")
    );

    expect(students).toHaveLength(2);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].line).toBe(3);
  });

  it("reports line numbers against the uploaded file", () => {
    const { rejected } = parse(
      ["name,email", "Jane Doe,jdoe27@students.coderva.org", "Nobody,junk"].join("\n")
    );

    expect(rejected[0].line).toBe(3);
  });

  it("returns nothing for an empty file", () => {
    expect(parse("")).toEqual({ students: [], rejected: [] });
  });

  it("returns nothing for a header with no rows under it", () => {
    expect(parse("name,email\n")).toEqual({ students: [], rejected: [] });
  });
});
