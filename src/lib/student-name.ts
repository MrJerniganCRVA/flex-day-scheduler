/**
 * Ordering student names the way a roster is read.
 *
 * `User.name` is a single string — NextAuth writes whatever Google hands back at
 * first sign-in (src/auth.ts), and the CSV import writes one `name` column
 * (src/lib/student-import.ts). There is no separate surname field to sort on, so
 * every `orderBy: { student: { name: "asc" } }` in the app is really sorting by
 * first name. That is fine for a list an admin scans and wrong for a roster a
 * teacher calls names off, which is what this module fixes.
 *
 * Deliberately pure and Prisma-free, like the export/import modules beside it:
 * the database query stays shared, and the callers that want roster order
 * re-sort the rows they already have.
 */

/**
 * The token a name should sort on: the last whitespace-separated word.
 *
 * A heuristic, and the only one available against a single-string name. It gets
 * "Ada Lovelace" and "Jean-Luc Picard" right, and puts "Martin Luther King Jr"
 * under J — nobody can do better without a field that says which part is the
 * surname, and a wrong guess here costs a teacher one glance, not a placement.
 *
 * Mononyms fall back to the whole name rather than to an empty key, so a student
 * recorded as "Prince" sorts under P instead of ahead of the entire roster.
 */
export function lastNameKey(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 0 ? parts[parts.length - 1] : name.trim()).toLowerCase();
}

/**
 * Compare two names by surname, then by the full name.
 *
 * The full-name tiebreak is what makes the order total: two Smiths would
 * otherwise compare equal and land in whatever order the query returned, so the
 * same roster could print in two different orders on two different days.
 */
export function compareByLastName(a: string, b: string): number {
  const byLast = lastNameKey(a).localeCompare(lastNameKey(b));
  return byLast !== 0 ? byLast : a.localeCompare(b);
}

/**
 * A copy of `items` in roster order.
 *
 * Non-mutating: callers hand this Prisma result arrays, which are also being
 * read for counts and capacity bars elsewhere in the same render.
 */
export function sortByLastName<T>(items: readonly T[], name: (item: T) => string): T[] {
  return [...items].sort((a, b) => compareByLastName(name(a), name(b)));
}
