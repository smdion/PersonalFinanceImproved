/**
 * App settings parsing.
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
