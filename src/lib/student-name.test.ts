import { describe, it, expect } from "vitest";
import { compareByLastName, lastNameKey, sortByLastName } from "./student-name";

describe("lastNameKey", () => {
  it("takes the last word of a two-part name", () => {
    expect(lastNameKey("Ada Lovelace")).toBe("lovelace");
  });

  it("takes the last word past a middle name", () => {
    expect(lastNameKey("Grace Brewster Murray Hopper")).toBe("hopper");
  });

  it("lowercases, so case never decides the order", () => {
    expect(lastNameKey("ada LOVELACE")).toBe("lovelace");
  });

  it("keeps a hyphenated surname whole", () => {
    expect(lastNameKey("Jean-Luc Picard")).toBe("picard");
  });

  it("falls back to the whole name for a mononym", () => {
    expect(lastNameKey("Prince")).toBe("prince");
  });

  it("ignores stray whitespace rather than keying on an empty token", () => {
    expect(lastNameKey("  Ada   Lovelace  ")).toBe("lovelace");
  });
});

describe("compareByLastName", () => {
  it("orders by surname, not by first name", () => {
    expect(compareByLastName("Zoe Adams", "Aaron Baker")).toBeLessThan(0);
  });

  it("breaks a shared surname on the full name", () => {
    expect(compareByLastName("Beth Smith", "Alan Smith")).toBeGreaterThan(0);
  });

  it("is zero only for the same name", () => {
    expect(compareByLastName("Ada Lovelace", "Ada Lovelace")).toBe(0);
  });
});

describe("sortByLastName", () => {
  const roster = [
    { name: "Zoe Adams" },
    { name: "Beth Smith" },
    { name: "Aaron Baker" },
    { name: "Alan Smith" },
  ];

  it("puts a roster in surname order", () => {
    expect(sortByLastName(roster, (s) => s.name).map((s) => s.name)).toEqual([
      "Zoe Adams",
      "Aaron Baker",
      "Alan Smith",
      "Beth Smith",
    ]);
  });

  it("does not mutate the array it was handed", () => {
    const before = roster.map((s) => s.name);
    sortByLastName(roster, (s) => s.name);
    expect(roster.map((s) => s.name)).toEqual(before);
  });

  it("is stable across input orders — two prints of one roster agree", () => {
    const names = (rows: { name: string }[]) =>
      sortByLastName(rows, (s) => s.name).map((s) => s.name);
    expect(names([...roster].reverse())).toEqual(names(roster));
  });
});
