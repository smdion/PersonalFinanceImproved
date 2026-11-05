/**
 * Find the primary person from a people array.
 * Falls back to first person if no isPrimaryUser flag is set.
 */
export function getPrimaryPerson<T extends { isPrimaryUser: boolean }>(
  people: T[],
): T | null {
  return people.find((p) => p.isPrimaryUser) ?? people[0] ?? null;
}
