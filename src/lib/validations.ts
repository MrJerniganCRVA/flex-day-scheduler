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
  // Admin only — ignored for teachers, who always own the clubs they create.
  // Explicit null means "no teacher assigned": an admin-managed club, whose
  // teacher is set per session on the Coverage page.
  ownerId: z.string().cuid().nullable().optional(),
  allowRandomAssignment: z.boolean().optional(),
  linkedRotations: z.boolean().optional(),
  cosponsorId: z.string().cuid().nullable().optional(),
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
  // Admin can reassign ownership, or clear it with an explicit null to make the
  // club admin-managed with no permanent teacher.
  ownerId: z.string().cuid().nullable().optional(),
  allowRandomAssignment: z.boolean().optional(),
  linkedRotations: z.boolean().optional(),
  cosponsorId: z.string().cuid().nullable().optional(),
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

/**
 * Admin roster override, used after calendar invites have already gone out.
 * `reason` is required because this writes an audit row — an override with no
 * recorded justification is the thing that makes "why was my child moved?"
 * unanswerable later.
 */
export const rosterOverrideSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("move"),
    signupId: z.string().cuid(),
    toClubSessionId: z.string().cuid(),
    reason: z.string().trim().min(3, "A reason is required").max(500),
  }),
  z.object({
    action: z.literal("remove"),
    signupId: z.string().cuid(),
    reason: z.string().trim().min(3, "A reason is required").max(500),
  }),
  z.object({
    action: z.literal("add"),
    studentId: z.string().cuid(),
    toClubSessionId: z.string().cuid(),
    reason: z.string().trim().min(3, "A reason is required").max(500),
  }),
]);

/**
 * Adding a student to a club's required-member roster. No reason field, unlike
 * rosterOverrideSchema: this is a standing statement about who belongs to the
 * club, not a one-off exception to the signup rules that someone will later be
 * asked to justify.
 */
export const addRequiredMemberSchema = z.object({
  studentId: z.string().cuid(),
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

/**
 * A supervision post that is not a club. `requiredRotations` is the standing
 * requirement rather than a default, so it may not be empty: a post that needs
 * staffing in no rotation is a post that does not need to exist, and an empty
 * array would render as a card with no slots on the Coverage page.
 */
export const createDutyPostSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  location: z.string().trim().max(100).optional(),
  requiredRotations: z
    .array(z.enum(["FLEX_1", "FLEX_2", "FLEX_3"] as [RotationSlot, ...RotationSlot[]]))
    .min(1, "At least one rotation is required"),
});

export const updateDutyPostSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100).optional(),
  location: z.string().trim().max(100).nullable().optional(),
  requiredRotations: z
    .array(z.enum(["FLEX_1", "FLEX_2", "FLEX_3"] as [RotationSlot, ...RotationSlot[]]))
    .min(1, "At least one rotation is required")
    .optional(),
  isActive: z.boolean().optional(),
});

/**
 * Staff one rotation of one duty post on one Flex Day. `teacherId: null` clears
 * it — unambiguous here, because a duty post has no owner to fall back to.
 */
export const dutyAssignmentSchema = z.object({
  dutyPostId: z.string().cuid(),
  flexDayId: z.string().cuid(),
  rotation: z.enum(["FLEX_1", "FLEX_2", "FLEX_3"] as [RotationSlot, ...RotationSlot[]]),
  teacherId: z.string().cuid().nullable(),
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
});

/**
 * Mark a teacher present or absent for a session.
 *
 * `teacherId` is optional and admin-only: a teacher acting on their own behalf
 * omits it. `rotations` defaults to every rotation the session covers.
 */
export const sessionAbsenceSchema = z.object({
  teacherId: z.string().cuid().optional(),
  rotations: z
    .array(z.enum(["FLEX_1", "FLEX_2", "FLEX_3"] as [RotationSlot, ...RotationSlot[]]))
    .min(1)
    .optional(),
  absent: z.boolean(),
  reason: z.string().trim().max(300).optional(),
});
