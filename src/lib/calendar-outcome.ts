import type { RotationSlot } from "@prisma/client";

/**
 * What happened to each block we tried to send, and how to say it to an admin.
 *
 * A "block" is one rotation of one thing that has to happen — a club session, or
 * a duty post. Both kinds settle into the same three outcomes and are reported in
 * one list, because an admin looking at a finalized Flex Day wants the whole set
 * of things needing attention, not two.
 *
 * Lifted out of the finalize route when duty posts started producing blocks of
 * their own. The wording here is the only thing that ever told an admin a block
 * got no invite, so it is worth keeping in one place: before it existed the
 * button simply went green and a whole day of failures was visible only in the
 * server log.
 */

/** One rotation of one session or duty post — what an invite actually covers. */
export type BlockRef = {
  rotation: RotationSlot;
  /** "Art Club — Flex 2", or "Cafeteria duty — Flex 2", for the admin report. */
  label: string;
};

/**
 * The block's invite went out. `fellBackFrom` is set when it was sent from an
 * admin because the assigned teacher could not send it themselves: `teacherName`
 * names them, or is null when nobody was assigned to the block at all.
 */
export type SentOutcome = BlockRef & {
  kind: "sent";
  fellBackFrom: { teacherName: string | null } | null;
};

/** Google rejected the request. */
export type FailedOutcome = BlockRef & { kind: "failed"; error: unknown };

/** Nobody could send it — not the assigned teacher, and not any admin. */
export type SkippedOutcome = BlockRef & {
  kind: "skipped";
  teacherName: string | null;
  /**
   * Why it was skipped. "unstaffed" means nobody is assigned to the block at
   * all; "no-calendar" means somebody is, but neither they nor any admin can
   * send. The distinction changes what an admin has to do about it, and a duty
   * post can be unstaffed while every teacher in the building has connected.
   */
  reason: "unstaffed" | "no-calendar";
};

export type BlockOutcome = SentOutcome | FailedOutcome | SkippedOutcome;

export const isSent = (o: BlockOutcome): o is SentOutcome => o.kind === "sent";
export const isFailed = (o: BlockOutcome): o is FailedOutcome =>
  o.kind === "failed";
export const isSkipped = (o: BlockOutcome): o is SkippedOutcome =>
  o.kind === "skipped";

/**
 * Whether Google is saying the event we tried to patch is not there.
 *
 * 404 for an event that never existed or was hard-deleted, 410 for one Google
 * still remembers as cancelled. Both mean the same thing to the caller: stop
 * patching and issue a new one.
 */
export function isMissingEvent(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as {
    code?: number | string;
    status?: number;
    response?: { status?: number };
  };
  const status =
    err.response?.status ??
    err.status ??
    (typeof err.code === "number" ? err.code : Number(err.code));
  return status === 404 || status === 410;
}

/**
 * Google's own explanation of a rejection.
 *
 * Worth digging for: every failure used to be reported to the admin as
 * "Google Calendar rejected the request", which is how a whole day of invites
 * failing on one fixable cause — a service account that was never allowed to
 * invite anybody — could only be diagnosed by reading server logs.
 */
export function googleErrorReason(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;

  const err = error as {
    errors?: { message?: string; reason?: string }[];
    response?: { data?: { error?: { message?: string } | string } };
    message?: string;
  };

  const first = Array.isArray(err.errors) ? err.errors[0] : undefined;
  const nested = err.response?.data?.error;
  const nestedMessage = typeof nested === "string" ? nested : nested?.message;

  const reason =
    first?.message ?? first?.reason ?? nestedMessage ?? err.message ?? null;
  return reason ? reason.trim().replace(/\.$/, "") : null;
}

/** Admin-readable one-liners for anything an admin should act on. */
export function describeProblems(blocks: BlockOutcome[]): string[] {
  const problems: string[] = [];

  for (const f of blocks.filter(isFailed)) {
    const reason = googleErrorReason(f.error);
    problems.push(
      reason
        ? `${f.label}: Google Calendar rejected the request — ${reason}.`
        : `${f.label}: Google Calendar rejected the request.`
    );
  }

  for (const s of blocks.filter(isSkipped)) {
    if (s.reason === "unstaffed") {
      problems.push(
        `${s.label}: nobody is assigned to cover this block, so no invite was sent.`
      );
      continue;
    }
    problems.push(
      s.teacherName
        ? `${s.label}: ${s.teacherName} has not connected their Google Calendar and no admin has either, so no invites were sent. Ask them to open the app and connect it, then re-send.`
        : `${s.label}: nobody is assigned to cover this block and no admin has connected a Google Calendar, so no invites were sent.`
    );
  }

  // Sent, but not by the person who should have sent it. Not a failure — the
  // invite exists — so it is reported after the real problems.
  for (const s of blocks.filter(isSent).filter((o) => o.fellBackFrom !== null)) {
    problems.push(
      s.fellBackFrom!.teacherName
        ? `${s.label}: ${s.fellBackFrom!.teacherName} has not connected their Google Calendar, so the invite was sent from an admin instead.`
        : `${s.label}: nobody is assigned to cover this block, so the invite was sent from an admin instead.`
    );
  }

  return problems;
}
