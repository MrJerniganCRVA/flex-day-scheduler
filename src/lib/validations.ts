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
  maxCapacity: z.number().int().positive(),
  location: z.string().max(100).optional(),
  defaultRotations: z
    .array(z.enum(["FLEX_1", "FLEX_2", "FLEX_3"] as [RotationSlot, ...RotationSlot[]]))
    .min(1, "At least one rotation is required"),
  ownerId: z.string().cuid().optional(), // admin only — ignored for teachers
});

export const updateClubSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  maxCapacity: z.number().int().positive(),
  location: z.string().max(100).optional(),
  defaultRotations: z
    .array(z.enum(["FLEX_1", "FLEX_2", "FLEX_3"] as [RotationSlot, ...RotationSlot[]]))
    .min(1, "At least one rotation is required"),
});

export const createClubSessionSchema = z.object({
  flexDayId: z.string().cuid(),
  rotations: z
    .array(z.enum(["FLEX_1", "FLEX_2", "FLEX_3"] as [RotationSlot, ...RotationSlot[]]))
    .min(1, "At least one rotation is required"),
  locationOverride: z.string().max(100).optional(), // overrides club's default room for this session
});

export const updateClubSessionSchema = z.object({
  rotations: z
    .array(z.enum(["FLEX_1", "FLEX_2", "FLEX_3"] as [RotationSlot, ...RotationSlot[]]))
    .min(1, "At least one rotation is required")
    .optional(),
  locationOverride: z.string().max(100).optional(),
});

export const createSignupSchema = z.object({
  clubSessionId: z.string().cuid(),
});

export const updateUserRoleSchema = z.object({
  role: z.enum(["STUDENT", "TEACHER", "ADMIN"] as [Role, ...Role[]]),
});
