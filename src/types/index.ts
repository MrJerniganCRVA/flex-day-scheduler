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
