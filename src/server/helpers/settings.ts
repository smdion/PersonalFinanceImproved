/**
 * App settings parsing and IRS limit helpers.
 */

/**
 * Parse app_settings rows into a typed lookup helper.
 * Replaces the inline `settingsMap` / `setting()` pattern used across routers.
 */
export function parseAppSettings(
  settings: { key: string; value: unknown }[],
): (key: string, fallback: number) => number {
  const map = new Map(settings.map((s) => [s.key, s.value]));
  return (key: string, fallback: number) => {
    const v = map.get(key);
    return typeof v === "number" ? v : fallback;
  };
}

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
