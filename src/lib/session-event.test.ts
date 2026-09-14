import { describe, it, expect } from "vitest";
import {
  resolveRoomName,
  rotationLabel,
  rotationName,
  sessionEventDescription,
  sessionEventTitle,
} from "./session-event";

/**
 * The exact text of a calendar invite.
 *
 * These strings are read by a student deciding which door to walk through, and
 * they are sent once — a wrong room reaches everyone at the same moment and is
 * only correctable by re-finalizing the day. The no-room fallback is the case
 * most worth pinning here: every club has a room assigned today, so that branch
 * is the one nobody would notice breaking until a new club shipped a malformed
 * "Art Club ()" invite to a whole cohort.
 */

describe("resolveRoomName", () => {
  it("prefers a session's room override over the club default", () => {
    expect(
      resolveRoomName({
        roomOverride: { name: "Gym" },
        club: { defaultRoom: { name: "Room 205" } },
      })
    ).toBe("Gym");
  });

  it("falls back to the club default when there is no override", () => {
    expect(
      resolveRoomName({
        roomOverride: null,
        club: { defaultRoom: { name: "Room 205" } },
      })
    ).toBe("Room 205");
  });

  it("is null when neither is set", () => {
    expect(resolveRoomName({ roomOverride: null, club: { defaultRoom: null } })).toBeNull();
  });

  it("is null for a one-off session with no club and no override", () => {
    expect(resolveRoomName({ roomOverride: null, club: null })).toBeNull();
  });

  it("uses the override for a one-off session, which has no club to fall back to", () => {
    expect(resolveRoomName({ roomOverride: { name: "Library" }, club: null })).toBe(
      "Library"
    );
  });
});

describe("rotationName", () => {
  it("spells one rotation the way an invite does", () => {
    expect(rotationName("FLEX_1")).toBe("Flex 1");
    expect(rotationName("FLEX_3")).toBe("Flex 3");
  });
});

describe("rotationLabel", () => {
  it("names a single rotation", () => {
    expect(rotationLabel(["FLEX_1"])).toBe("Flex 1");
  });

  it("joins a linked session's rotations", () => {
    expect(rotationLabel(["FLEX_1", "FLEX_2"])).toBe("Flex 1 + Flex 2");
  });

  it("sorts into timetable order rather than trusting the stored order", () => {
    expect(rotationLabel(["FLEX_3", "FLEX_1"])).toBe("Flex 1 + Flex 3");
  });

  it("handles all three", () => {
    expect(rotationLabel(["FLEX_2", "FLEX_3", "FLEX_1"])).toBe(
      "Flex 1 + Flex 2 + Flex 3"
    );
  });

  it("is empty for no rotations", () => {
    expect(rotationLabel([])).toBe("");
  });
});

describe("sessionEventTitle", () => {
  it("puts the room in the title", () => {
    expect(
      sessionEventTitle({ name: "Art Club", roomName: "Room 205", rotation: "FLEX_1" })
    ).toBe("Art Club (Room 205)");
  });

  it("titles each block of a linked session identically", () => {
    // A linked session sends one invite per rotation. They are told apart by
    // their times, not their titles — the rotation is deliberately absent from
    // the title, so both blocks of an Esports double read the same.
    const base = { name: "Esports", roomName: "Lab B" } as const;
    expect(sessionEventTitle({ ...base, rotation: "FLEX_1" })).toBe("Esports (Lab B)");
    expect(sessionEventTitle({ ...base, rotation: "FLEX_2" })).toBe("Esports (Lab B)");
  });

  it("falls back to the rotation when the club has no room", () => {
    expect(
      sessionEventTitle({ name: "Art Club", roomName: null, rotation: "FLEX_1" })
    ).toBe("Art Club (Flex 1)");
  });

  it("names its own block in the roomless fallback, not the whole session", () => {
    // The old behavior joined every rotation here, so the Flex 2 invite of a
    // linked session read "(Flex 1 + Flex 2)" — naming a block it did not cover.
    expect(
      sessionEventTitle({ name: "Esports", roomName: null, rotation: "FLEX_2" })
    ).toBe("Esports (Flex 2)");
  });

  it("uses a one-off session's own title unchanged", () => {
    expect(
      sessionEventTitle({
        name: "College Essay Workshop",
        roomName: "Library",
        rotation: "FLEX_2",
      })
    ).toBe("College Essay Workshop (Library)");
  });
});

describe("sessionEventDescription", () => {
  it("names the room, the rotation and one teacher", () => {
    expect(
      sessionEventDescription({
        roomName: "Room 205",
        rotation: "FLEX_1",
        teacherNames: ["Ms Rivera"],
      })
    ).toBe("Room: Room 205\nWhen: Flex 1\nTeacher: Ms Rivera");
  });

  it("pluralises for several teachers and lists them", () => {
    expect(
      sessionEventDescription({
        roomName: "Gym",
        rotation: "FLEX_2",
        teacherNames: ["Ms Rivera", "Mr Okafor"],
      })
    ).toBe("Room: Gym\nWhen: Flex 2\nTeachers: Ms Rivera, Mr Okafor");
  });

  it("names only the block it covers, not the whole session", () => {
    // The point of the per-rotation split: a session linked across Flex 1 and
    // Flex 2 sends two invites, and the Flex 2 one must say "Flex 2". The old
    // behavior joined every rotation into "Flex 1 + Flex 2" on both.
    expect(
      sessionEventDescription({
        roomName: "Lab B",
        rotation: "FLEX_2",
        teacherNames: ["Mr Okafor"],
      })
    ).toBe("Room: Lab B\nWhen: Flex 2\nTeacher: Mr Okafor");
  });

  it("omits the teacher line entirely when nobody is assigned", () => {
    // An admin-managed club with no owner resolves to no teacher. A "Teachers:"
    // line with nothing after it would read as a bug to a parent.
    expect(
      sessionEventDescription({
        roomName: "Room 205",
        rotation: "FLEX_1",
        teacherNames: [],
      })
    ).toBe("Room: Room 205\nWhen: Flex 1");
  });

  it("says so rather than going blank when there is no room", () => {
    expect(
      sessionEventDescription({
        roomName: null,
        rotation: "FLEX_1",
        teacherNames: ["Ms Rivera"],
      })
    ).toBe("Room: not yet assigned\nWhen: Flex 1\nTeacher: Ms Rivera");
  });
});
