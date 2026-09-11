import { describe, it, expect } from "vitest";
import { classifyEmail, nameFromEmail } from "./email-domain";

const DOMAIN = "coderva.org";

describe("classifyEmail", () => {
  it("treats the students subdomain as a student", () => {
    expect(classifyEmail("jdoe27@students.coderva.org", DOMAIN)).toBe("student");
  });

  it("treats the bare domain as staff", () => {
    expect(classifyEmail("mjernigan@coderva.org", DOMAIN)).toBe("teacher");
  });

  // The ordering bug this guards against would make every student a teacher:
  // a student address also ends with "students.coderva.org", so testing the
  // bare domain first matches it.
  it("does not mistake a student for staff", () => {
    expect(classifyEmail("jdoe27@students.coderva.org", DOMAIN)).not.toBe("teacher");
  });

  it("rejects any other domain", () => {
    expect(classifyEmail("jdoe27@gmail.com", DOMAIN)).toBe("outside");
    expect(classifyEmail("jdoe27@notcoderva.org", DOMAIN)).toBe("outside");
  });

  it("rejects a domain that merely contains the school's", () => {
    expect(classifyEmail("attacker@coderva.org.evil.com", DOMAIN)).toBe("outside");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(classifyEmail("  JDoe27@Students.CodeRVA.org ", DOMAIN)).toBe("student");
  });

  // Fail closed: an unset ALLOWED_EMAIL_DOMAIN must let nobody in rather than
  // matching everybody, which is what `endsWith("@")` would have done.
  it("lets nobody in when no domain is configured", () => {
    expect(classifyEmail("jdoe27@students.coderva.org", "")).toBe("outside");
  });

  it("rejects an empty address", () => {
    expect(classifyEmail("", DOMAIN)).toBe("outside");
  });
});

describe("nameFromEmail", () => {
  it("splits and title-cases a dotted local part", () => {
    expect(nameFromEmail("jane.doe@students.coderva.org")).toBe("Jane Doe");
  });

  it("handles underscores and hyphens the same way", () => {
    expect(nameFromEmail("jane_doe@students.coderva.org")).toBe("Jane Doe");
    expect(nameFromEmail("mary-jane.watson@students.coderva.org")).toBe(
      "Mary Jane Watson"
    );
  });

  it("just capitalizes a local part with no separators", () => {
    expect(nameFromEmail("jdoe27@students.coderva.org")).toBe("Jdoe27");
  });

  it("normalizes shouty addresses", () => {
    expect(nameFromEmail("JANE.DOE@students.coderva.org")).toBe("Jane Doe");
  });

  it("falls back to the input when there is no local part", () => {
    expect(nameFromEmail("@students.coderva.org")).toBe("@students.coderva.org");
  });
});
