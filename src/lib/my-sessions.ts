/**
 * "The sessions I am attached to on a Flex Day."
 *
 * Lived inside src/components/dashboard/MyFlexDay.tsx until the printable roster
 * needed the same answer. Two definitions of who is attached to a session would
 * be two chances to print a roster the dashboard never showed — or, worse, to
 * hand one teacher another's roster.
 */

/**
 * Prisma `where` for the club sessions a user is attached to.
 *
 * Coverage assignments are in here deliberately. Filtering on club ownership and
 * cosponsorship alone meant a teacher an admin had assigned to cover someone
 * else's club never saw that session anywhere in the app — and for a club with
 * no owner, coverage is the *only* way anyone is attached to it, which made
 * those clubs invisible to the very people running them.
 */
export function mySessionsFilter(userId: string) {
  return {
    OR: [
      { club: { ownerId: userId } },
      { club: { cosponsorId: userId } },
      { oneOffOwnerId: userId },
      { rotationCoverage: { some: { primaryTeacherId: userId } } },
      { rotationCoverage: { some: { secondaryTeacherId: userId } } },
    ],
  };
}
