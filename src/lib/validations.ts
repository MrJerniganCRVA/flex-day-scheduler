import { z } from "zod";
import { Role, RotationSlot } from "@prisma/client";

export const createFlexDaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  label: z.string().max(100).optional(),
});

export const updateFlexDaySchema = z.object({
  label: z.string().max(100).optional(),
  isActive: z.boolean().optional(),
});

export const createClubSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  maxCapacity: z.number().int().positive().min(1).max(1000),
  defaultRoomId: z.string().cuid().optional(),
  defaultRotations: z
    .array(z.enum(["FLEX_1", "FLEX_2", "FLEX_3"] as [RotationSlot, ...RotationSlot[]]))
    .min(1, "At least one rotation is required"),
  ownerId: z.string().cuid().optional(), // admin only — ignored for teachers
  allowRandomAssignment: z.boolean().optional(),
  defaultCoTeacherId: z.string().cuid().optional(),
  defaultLinked: z.boolean().optional(),
});

export const updateClubSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  maxCapacity: z.number().int().positive().min(1).max(1000).optional(),
  defaultRoomId: z.string().cuid().optional(),
  defaultRotations: z
    .array(z.enum(["FLEX_1", "FLEX_2", "FLEX_3"] as [RotationSlot, ...RotationSlot[]]))
    .min(1, "At least one rotation is required")
    .optional(),
  ownerId: z.string().cuid().optional(), // admin can reassign club ownership
  allowRandomAssignment: z.boolean().optional(),
  defaultCoTeacherId: z.string().cuid().nullable().optional(),
  defaultLinked: z.boolean().optional(),
});

export const createClubSessionSchema = z.object({
  flexDayId: z.string().cuid(),
  rotations: z
    .array(z.enum(["FLEX_1", "FLEX_2", "FLEX_3"] as [RotationSlot, ...RotationSlot[]]))
    .min(1, "At least one rotation is required"),
  roomOverrideId: z.string().cuid().optional(), // overrides club's default room for this session
});

export const updateClubSessionSchema = z.object({
  rotations: z
    .array(z.enum(["FLEX_1", "FLEX_2", "FLEX_3"] as [RotationSlot, ...RotationSlot[]]))
    .min(1, "At least one rotation is required")
    .optional(),
  roomOverrideId: z.string().cuid().nullable().optional(),
  capacityOverride: z.number().int().positive().min(1).nullable().optional(),
});

export const createSignupSchema = z.object({
  clubSessionId: z.string().cuid(),
});

export const updateUserRoleSchema = z.object({
  role: z.enum(["STUDENT", "TEACHER", "ADMIN"] as [Role, ...Role[]]),
});

export const createRoomSchema = z.object({
  name: z.string().min(1, "Room name is required").max(100),
  capacity: z.number().int().positive().min(1).max(1000),
});

export const updateRoomSchema = z.object({
  name: z.string().min(1, "Room name is required").max(100).optional(),
  capacity: z.number().int().positive().min(1).max(1000).optional(),
  isActive: z.boolean().optional(),
});

export const bulkAttendanceSchema = z.object({
  records: z
    .array(
      z.object({
        signupId: z.string().cuid(),
        attended: z.boolean(),
      })
    )
    .min(1),
});

export const createOneOffSchema = z.object({
  flexDayId: z.string().cuid(),
  title: z.string().min(1).max(100),
  rotations: z
    .array(z.enum(["FLEX_1", "FLEX_2", "FLEX_3"] as [RotationSlot, ...RotationSlot[]]))
    .min(1, "At least one rotation is required"),
  roomOverrideId: z.string().cuid(),
  capacity: z.number().int().positive().min(1).max(1000),
});

export const updateClubSessionPerDaySchema = z.object({
  rotations: z
    .array(z.enum(["FLEX_1", "FLEX_2", "FLEX_3"] as [RotationSlot, ...RotationSlot[]]))
    .min(1, "At least one rotation is required")
    .optional(),
  roomOverrideId: z.string().cuid().nullable().optional(),
  capacityOverride: z.number().int().positive().min(1).nullable().optional(),
  teacherAbsent: z.boolean().optional(),
});
