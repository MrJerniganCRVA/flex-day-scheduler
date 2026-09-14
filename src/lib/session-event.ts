import type { RotationSlot } from "@prisma/client";
import { ALL_ROTATIONS } from "@/types";

/**
 * What a session's calendar invite says, and where the room comes from.
 *
 * Kept free of any Prisma import, like src/lib/required-members.ts and
 * src/lib/student-schedule.ts: these are the exact strings a student and a
 * teacher read on the morning of a Flex Day, and they are worth testing without
 * a database or a Google account standing behind them.
 *
 * The title rule is the school's, not this app's: an invite reads
 * "Art Club (Room 205)", because a student scanning a month grid needs the room
 * without opening anything. Google's own `location` field is still populated —
 * it is what makes the event's map link and "where" row work — but most calendar
 * views do not surface it until the event is opened, which is why the room is
 * also in the title rather than only there.
 *
 * The rotation is deliberately *not* in the title. It used to be, and it is
 * redundant: the event's start and end times already say which block it is. That
 * holds more strongly now than when it was written, because a session linked
 * across several rotations no longer produces one long block — it produces one
 * event per rotation, each sitting at its own bell times. The rotation still
 * appears in the description, spelled out.
 *
 * Title and body therefore describe **one rotation**, not a session. A linked
 * Flex 1 to Flex 3 club sends three invites, each naming its own block and only
 * the teachers covering that block.
 */

/** Anything carrying the two places a room can come from. */
export interface SessionRoomRef {
  roomOverride: { name: string } | null;
  club: { defaultRoom: { name: string } | null } | null;
}

/**
 * The room a session actually meets in.
 *
 * A per-session override wins over the club's default — that is the whole point
 * of the override, a club meeting somewhere else just this once. Null when the
 * club has no default room and the session sets none, which the schema allows
 * (`Club.defaultRoomId` is optional, and the club form offers "No default
 * room"). Callers must handle that rather than rendering an empty string.
 */
export function resolveRoomName(session: SessionRoomRef): string | null {
  return session.roomOverride?.name ?? session.club?.defaultRoom?.name ?? null;
}

/** "FLEX_1" -> "Flex 1". The spelling every invite and screen uses. */
export function rotationName(rotation: RotationSlot): string {
  return rotation.replace("FLEX_", "Flex ");
}

/**
 * "Flex 1", or "Flex 1 + Flex 2" for a set of rotations.
 *
 * Sorted into timetable order rather than trusting the stored array's order, so
 * a session whose rotations were saved out of order does not read "Flex 2 +
 * Flex 1".
 *
 * No longer used by the invite itself, which is per-rotation. Kept for the
 * screens that describe a whole session at a glance.
 */
export function rotationLabel(rotations: RotationSlot[]): string {
  const present = new Set(rotations);
  return ALL_ROTATIONS.filter((r) => present.has(r))
    .map(rotationName)
    .join(" + ");
}

/**
 * The invite's title: "Art Club (Room 205)".
 *
 * With no room it falls back to the rotation — "Art Club (Flex 1)" — rather
 * than emitting "Art Club ()" or a bare name. Every club has a room assigned
 * today, so this branch should never fire in practice; it exists because the
 * schema still permits a roomless club and a silently malformed title is worse
 * than a slightly less useful one. The admin Flex Day page flags such a session
 * before invites are sent, which is where it should be caught.
 */
export function sessionEventTitle(params: {
  name: string;
  roomName: string | null;
  rotation: RotationSlot;
}): string {
  const qualifier = params.roomName ?? rotationName(params.rotation);
  return qualifier ? `${params.name} (${qualifier})` : params.name;
}

/**
 * The invite's body.
 *
 * The second place to check, and the only place a teacher's name appears at
 * all — the title has no room for it and Google's `location` field is a single
 * line. Written as plain text, not HTML: Google renders either, and plain text
 * is what survives being forwarded, printed, or read on a watch.
 *
 * `teacherNames` are the teachers covering **this rotation**, so a club whose
 * sponsor hands over to somebody else after Flex 1 names the right person in
 * each of its invites rather than listing both on both.
 */
export function sessionEventDescription(params: {
  roomName: string | null;
  rotation: RotationSlot;
  teacherNames: string[];
}): string {
  const lines: string[] = [];

  lines.push(`Room: ${params.roomName ?? "not yet assigned"}`);

  // Exact rather than a summary: this event covers this block and no other, so
  // the line names the block a guest is actually being invited to.
  lines.push(`When: ${rotationName(params.rotation)}`);

  if (params.teacherNames.length > 0) {
    lines.push(
      `${params.teacherNames.length === 1 ? "Teacher" : "Teachers"}: ${params.teacherNames.join(", ")}`
    );
  }

  return lines.join("\n");
}
