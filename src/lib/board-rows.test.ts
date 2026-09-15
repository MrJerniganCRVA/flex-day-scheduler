import { describe, it, expect } from "vitest";
import type { RotationSlot } from "@prisma/client";
import { buildBoardRows, type BoardSession } from "./board-rows";

/**
 * The rules these cover were invisible until a second screen needed them.
 *
 * They came out of the Coverage grid, where the bug being fixed was an unlinked
 * club drawing three separate lines — each with one cell filled and two hatched
 * — for a club that was simply running all day. Getting that wrong on the
 * read-only board would be the same mistake in a second place, which is the
 * whole reason the logic moved here.
 */

function session(
  id: string,
  rotations: RotationSlot[],
  opts: { clubId?: string | null; name?: string; roomName?: string | null } = {}
): BoardSession {
  return {
    sessionId: id,
    clubId: opts.clubId === undefined ? "club-a" : opts.clubId,
    name: opts.name ?? "Art Club",
    ownerName: null,
    cosponsorName: null,
    roomName: opts.roomName === undefined ? "Room 205" : opts.roomName,
    rotations,
    studentCount: 0,
    assignments: {},
  };
}

/** The rotations a row actually fills, for terser assertions. */
const filled = (row: { sessions: Partial<Record<RotationSlot, unknown>> }) =>
  (["FLEX_1", "FLEX_2", "FLEX_3"] as RotationSlot[]).filter(
    (r) => row.sessions[r] !== undefined
  );

describe("buildBoardRows", () => {
  it("gives a linked club one row spanning every rotation it runs in", () => {
    const rows = buildBoardRows([
      session("s1", ["FLEX_1", "FLEX_2", "FLEX_3"]),
    ]);

    expect(rows).toHaveLength(1);
    expect(filled(rows[0])).toEqual(["FLEX_1", "FLEX_2", "FLEX_3"]);
    expect(rows[0].sessions.FLEX_2?.sessionId).toBe("s1");
  });

  it("merges an unlinked club's per-rotation sessions into a single row", () => {
    // The reported bug: three database rows for one club drew three lines.
    const rows = buildBoardRows([
      session("s1", ["FLEX_1"]),
      session("s2", ["FLEX_2"]),
      session("s3", ["FLEX_3"]),
    ]);

    expect(rows).toHaveLength(1);
    expect(filled(rows[0])).toEqual(["FLEX_1", "FLEX_2", "FLEX_3"]);
    // Each cell keeps its own session — they have separate rosters and rooms.
    expect(rows[0].sessions.FLEX_1?.sessionId).toBe("s1");
    expect(rows[0].sessions.FLEX_3?.sessionId).toBe("s3");
  });

  it("gives two sessions of one club in the same rotation a row each", () => {
    // They cannot share a cell, so the second takes a new row rather than
    // silently overwriting the first.
    const rows = buildBoardRows([
      session("s1", ["FLEX_1", "FLEX_2"]),
      session("s2", ["FLEX_1"]),
    ]);

    expect(rows).toHaveLength(2);
    expect(filled(rows[0])).toEqual(["FLEX_1", "FLEX_2"]);
    expect(filled(rows[1])).toEqual(["FLEX_1"]);
    expect(rows[1].sessions.FLEX_1?.sessionId).toBe("s2");
    // Adjacent, and distinctly keyed — two rows keyed alike would collide in React.
    expect(rows[0].key).not.toBe(rows[1].key);
  });

  it("never merges one-off sessions, which belong to no club", () => {
    const rows = buildBoardRows([
      session("s1", ["FLEX_1"], { clubId: null, name: "Makeup Testing" }),
      session("s2", ["FLEX_2"], { clubId: null, name: "Yearbook Photos" }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.name)).toEqual(["Makeup Testing", "Yearbook Photos"]);
  });

  it("puts the room on the row when every session in it agrees", () => {
    const rows = buildBoardRows([
      session("s1", ["FLEX_1"], { roomName: "Room 205" }),
      session("s2", ["FLEX_2"], { roomName: "Room 205" }),
    ]);

    expect(rows[0].roomName).toBe("Room 205");
  });

  it("leaves the row's room null when its sessions disagree", () => {
    // A row header claiming one room for sessions held in two would be worse
    // than saying nothing; the cells state their own instead.
    const rows = buildBoardRows([
      session("s1", ["FLEX_1"], { roomName: "Room 205" }),
      session("s2", ["FLEX_2"], { roomName: "Gym" }),
    ]);

    expect(rows[0].roomName).toBeNull();
  });

  it("leaves the row's room null when no session has one at all", () => {
    const rows = buildBoardRows([
      session("s1", ["FLEX_1", "FLEX_2"], { roomName: null }),
    ]);

    expect(rows[0].roomName).toBeNull();
  });

  it("keeps the order it was given, so an alphabetical input stays alphabetical", () => {
    const rows = buildBoardRows([
      session("s1", ["FLEX_1"], { clubId: "a", name: "Art Club" }),
      session("s2", ["FLEX_1"], { clubId: "c", name: "Chess Club" }),
      session("s3", ["FLEX_2"], { clubId: "a", name: "Art Club" }),
    ]);

    expect(rows.map((r) => r.name)).toEqual(["Art Club", "Chess Club"]);
  });
});
