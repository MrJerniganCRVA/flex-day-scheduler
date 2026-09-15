import { calendar_v3 } from "googleapis";
import { getCalendarClientForUser } from "@/lib/google-oauth";
import prisma from "@/lib/prisma";

/**
 * Deciding *whose* calendar a block's event lands on.
 *
 * Every event this app creates is written to a real person's `primary` calendar
 * over OAuth — Google refuses an attendee list from an unimpersonated service
 * account, and this Workspace grants no Domain-Wide Delegation. So before
 * anything can be sent, two questions have to be answered: can the person who
 * *should* send this actually send it, and if not, who covers for them?
 *
 * Both answers were worked out inline in the finalize route until duty posts
 * needed them too. They live here so the two passes share one client cache and
 * one backstop resolution rather than each refreshing the same admin's token.
 */

/** A calendar client together with the id of whose calendar it writes to. */
export type Sender = { client: calendar_v3.Calendar; userId: string };

/** Resolves a user to a calendar client, or null when they cannot send. */
export type ClientFor = (userId: string) => Promise<calendar_v3.Calendar | null>;

/**
 * One client per user, however many blocks they cover.
 *
 * Memoized on the **promise** rather than on the result, so concurrent blocks
 * share a single token refresh instead of racing to perform their own.
 */
export function makeClientCache(): ClientFor {
  const cache = new Map<string, Promise<calendar_v3.Calendar | null>>();
  return (userId: string) => {
    let pending = cache.get(userId);
    if (!pending) {
      pending = getCalendarClientForUser(userId);
      cache.set(userId, pending);
    }
    return pending;
  };
}

/**
 * The admin whose calendar covers blocks their assigned teacher cannot send
 * from.
 *
 * Prefers whoever pressed the button — they are present, and the resulting
 * invite comes from a person the school can ask about it — and otherwise any
 * admin who has connected. Resolves to null when no admin has connected either,
 * which is the one case where a block genuinely cannot be sent by anybody.
 *
 * Memoized: the search is the same for every block, and it costs a query plus a
 * token refresh.
 */
export function makeBackstop(
  actorId: string,
  clientFor: ClientFor
): () => Promise<Sender | null> {
  let pending: Promise<Sender | null> | null = null;

  return () => {
    pending ??= (async () => {
      const own = await clientFor(actorId);
      if (own) return { client: own, userId: actorId };

      const admins = await prisma.user.findMany({
        where: {
          role: "ADMIN",
          id: { not: actorId },
          calendarGrant: { is: { revokedAt: null } },
        },
        select: { id: true },
      });
      for (const admin of admins) {
        const client = await clientFor(admin.id);
        if (client) return { client, userId: admin.id };
      }
      return null;
    })();
    return pending;
  };
}
