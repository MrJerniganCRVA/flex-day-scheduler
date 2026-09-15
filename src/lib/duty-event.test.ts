import { describe, it, expect } from "vitest";
import { dutyEventDescription, dutyEventTitle } from "./duty-event";

/**
 * The exact text of a duty post's calendar invite.
 *
 * Pinned for the same reason as the session strings next door: these are sent
 * once, to a teacher who will act on them, and a malformed one is only
 * correctable by re-issuing the event. The no-location branch matters more here
 * than the no-room branch does for sessions — `DutyPost.location` is optional by
 * design, and a post named "Front doors" is expected to leave it empty, so this
 * is an ordinary path rather than a defensive one.
 */

describe("dutyEventTitle", () => {
  it("names the post and its location", () => {
    expect(
      dutyEventTitle({
        postName: "Cafeteria",
        location: "2nd floor hallway",
        rotation: "FLEX_2",
      })
    ).toBe("Duty: Cafeteria (2nd floor hallway)");
  });

  it("falls back to the rotation when the post has no location", () => {
    expect(
      dutyEventTitle({ postName: "Front doors", location: null, rotation: "FLEX_1" })
    ).toBe("Duty: Front doors (Flex 1)");
  });

  it("marks the block as duty, so it reads apart from a club in a month grid", () => {
    expect(
      dutyEventTitle({ postName: "Library", location: "Library", rotation: "FLEX_3" })
    ).toMatch(/^Duty: /);
  });
});

describe("dutyEventDescription", () => {
  it("gives the post, the location and the block", () => {
    expect(
      dutyEventDescription({
        postName: "Cafeteria",
        location: "2nd floor hallway",
        rotation: "FLEX_2",
      })
    ).toBe("Post: Cafeteria\nWhere: 2nd floor hallway\nWhen: Flex 2");
  });

  it("says so plainly when the post has no location", () => {
    expect(
      dutyEventDescription({
        postName: "Front doors",
        location: null,
        rotation: "FLEX_1",
      })
    ).toBe("Post: Front doors\nWhere: not yet specified\nWhen: Flex 1");
  });

  it("names no teacher — the only person expected owns the calendar", () => {
    const body = dutyEventDescription({
      postName: "Cafeteria",
      location: "Cafeteria",
      rotation: "FLEX_2",
    });
    expect(body).not.toMatch(/Teacher/i);
  });
});
