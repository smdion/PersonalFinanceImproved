/**
 * Require an IRS limit from a DB-loaded limits record (or Map).
 * Throws if the key is missing — limits must exist in contribution_limits table.
 */
export function requireLimit(
  limits: Record<string, number> | Map<string, number>,
  key: string,
): number {
  const v = limits instanceof Map ? limits.get(key) : limits[key];
  if (v === undefined) {
    throw new Error(
      `Missing required IRS limit "${key}" in contribution_limits table`,
    );
  }
  return v;
}
