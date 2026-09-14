import { describe, it, expect } from "vitest";
import {
  resolveRoomName,
  rotationLabel,
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
      sessionEventTitle({ name: "Art Club", roomName: "Room 205", rotations: ["FLEX_1"] })
    ).toBe("Art Club (Room 205)");
  });

  it("keeps the room even for a session spanning several rotations", () => {
    expect(
      sessionEventTitle({
        name: "Esports",
        roomName: "Lab B",
        rotations: ["FLEX_1", "FLEX_2"],
      })
    ).toBe("Esports (Lab B)");
  });

  it("falls back to the rotation when the club has no room", () => {
    expect(
      sessionEventTitle({ name: "Art Club", roomName: null, rotations: ["FLEX_1"] })
    ).toBe("Art Club (Flex 1)");
  });

  it("falls back to the joined rotations for a roomless linked session", () => {
    expect(
      sessionEventTitle({
        name: "Esports",
        roomName: null,
        rotations: ["FLEX_1", "FLEX_2"],
      })
    ).toBe("Esports (Flex 1 + Flex 2)");
  });

  it("never emits empty parentheses", () => {
    // No room and no rotations should degrade to the bare name, not "Art Club ()".
    expect(sessionEventTitle({ name: "Art Club", roomName: null, rotations: [] })).toBe(
      "Art Club"
    );
  });

  it("uses a one-off session's own title unchanged", () => {
    expect(
      sessionEventTitle({
        name: "College Essay Workshop",
        roomName: "Library",
        rotations: ["FLEX_2"],
      })
    ).toBe("College Essay Workshop (Library)");
  });
});

describe("sessionEventDescription", () => {
  it("names the room, the rotation and one teacher", () => {
    expect(
      sessionEventDescription({
        roomName: "Room 205",
        rotations: ["FLEX_1"],
        teacherNames: ["Ms Rivera"],
      })
    ).toBe("Room: Room 205\nWhen: Flex 1\nTeacher: Ms Rivera");
  });

  it("pluralises for several teachers and lists them", () => {
    expect(
      sessionEventDescription({
        roomName: "Gym",
        rotations: ["FLEX_2", "FLEX_3"],
        teacherNames: ["Ms Rivera", "Mr Okafor"],
      })
    ).toBe("Room: Gym\nWhen: Flex 2 + Flex 3\nTeachers: Ms Rivera, Mr Okafor");
  });

  it("omits the teacher line entirely when nobody is assigned", () => {
    // An admin-managed club with no owner resolves to no teacher. A "Teachers:"
    // line with nothing after it would read as a bug to a parent.
    expect(
      sessionEventDescription({
        roomName: "Room 205",
        rotations: ["FLEX_1"],
        teacherNames: [],
      })
    ).toBe("Room: Room 205\nWhen: Flex 1");
  });

  it("says so rather than going blank when there is no room", () => {
    expect(
      sessionEventDescription({
        roomName: null,
        rotations: ["FLEX_1"],
        teacherNames: ["Ms Rivera"],
      })
    ).toBe("Room: not yet assigned\nWhen: Flex 1\nTeacher: Ms Rivera");
  });
});
