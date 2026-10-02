import { DefaultSession } from "next-auth";
import { Role, RotationSlot } from "@prisma/client";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
    } & DefaultSession["user"];
  }
}

export type { Role, RotationSlot };

export const ROTATION_LABELS: Record<RotationSlot, string> = {
  FLEX_1: "Flex 1",
  FLEX_2: "Flex 2",
  FLEX_3: "Flex 3",
};

export const ALL_ROTATIONS: RotationSlot[] = ["FLEX_1", "FLEX_2", "FLEX_3"];

/**
 * The compact form, for places that label a control rather than a heading — the
 * Coverage page's per-slot rows and its teacher availability chips. Lives here
 * rather than in a component because more than one now wants it.
 */
export const SHORT_ROTATION_LABELS: Record<RotationSlot, string> = {
  FLEX_1: "F1",
  FLEX_2: "F2",
  FLEX_3: "F3",
};

/** A room as the room pickers receive it from /api/rooms. */
export interface RoomOption {
  id: string;
  name: string;
  capacity: number;
}

/** Another single-rotation session of the same club that this one can link with. */
export interface SiblingSession {
  id: string;
  rotations: RotationSlot[];
}

/** A student who would be double-booked by a link, as the link route reports it. */
export interface ConflictDetail {
  studentName: string;
  rotation: RotationSlot;
  conflictingClub: string;
}
