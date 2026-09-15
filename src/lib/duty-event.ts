import type { RotationSlot } from "@prisma/client";
import { rotationName } from "@/lib/session-event";

/**
 * What a duty post's calendar invite says.
 *
 * The duty counterpart of src/lib/session-event.ts, and kept free of any Prisma
 * import for the same reason: these are the exact strings a teacher reads on the
 * morning of a Flex Day, and they are worth testing without a database or a
 * Google account standing behind them.
 *
 * Two differences from a session's invite, both deliberate.
 *
 * **The title is prefixed "Duty:".** A session's title is the club's own name,
 * which a teacher recognises. A duty post's name is a place — "Cafeteria",
 * "Front doors" — and a bare place name sitting in a month grid next to the
 * clubs someone runs does not say what it is asking of them. The prefix does.
 *
 * **The body names no teacher.** A session's invite lists its coverage because
 * several people are on the guest list and a student needs to know who is in the
 * room. A duty event has exactly one person on it, and it is sitting on their own
 * calendar, so a "Teacher: you" line would be noise.
 *
 * A duty post's location is free text ("2nd floor hallway", "front doors") rather
 * than a Room relation, because most duty spots are corridors and doors, not
 * bookable rooms. It is nullable, and both functions here handle that rather than
 * rendering an empty string.
 */

/** The prefix that marks a duty block apart from a club in a calendar grid. */
const DUTY_PREFIX = "Duty";

/**
 * The invite's title: "Duty: Cafeteria (2nd floor hallway)".
 *
 * With no location it falls back to the rotation — "Duty: Cafeteria (Flex 2)" —
 * rather than emitting "Duty: Cafeteria ()", matching how `sessionEventTitle`
 * handles a roomless club. Unlike a club, a duty post with no location is
 * entirely ordinary: `DutyPost.location` is optional and a post whose name is
 * already a place ("Front doors") has nothing to add.
 */
export function dutyEventTitle(params: {
  postName: string;
  location: string | null;
  rotation: RotationSlot;
}): string {
  const qualifier = params.location ?? rotationName(params.rotation);
  return `${DUTY_PREFIX}: ${params.postName} (${qualifier})`;
}

/**
 * The invite's body.
 *
 * Plain text, not HTML — Google renders either, and plain text is what survives
 * being forwarded, printed, or read on a watch. The `Where` line repeats the
 * location that is already in the title and in Google's own `location` field,
 * because most calendar views surface none of the three in the same place.
 */
export function dutyEventDescription(params: {
  postName: string;
  location: string | null;
  rotation: RotationSlot;
}): string {
  const lines: string[] = [];

  lines.push(`Post: ${params.postName}`);
  lines.push(`Where: ${params.location ?? "not yet specified"}`);
  lines.push(`When: ${rotationName(params.rotation)}`);

  return lines.join("\n");
}
