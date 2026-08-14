/**
 * Groups sessions by their Flex Day, preserving the input order of the first
 * occurrence of each day. Used to render one visual box per Flex Day even
 * when an unlinked club has multiple independent ClubSession rows on the
 * same day (one per rotation).
 */
export function groupSessionsByFlexDay<T extends { flexDay: { id: string } }>(
  sessions: T[]
): T[][] {
  const order: string[] = [];
  const groups = new Map<string, T[]>();

  for (const session of sessions) {
    const flexDayId = session.flexDay.id;
    const existing = groups.get(flexDayId);
    if (existing) {
      existing.push(session);
    } else {
      groups.set(flexDayId, [session]);
      order.push(flexDayId);
    }
  }

  return order.map((id) => groups.get(id)!);
}
