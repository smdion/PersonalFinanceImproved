/**
 * Which Retirement Profile is active, server-side: the one resolver every read
 * site uses (engine payload, snapshot, retirement router). Returns one id; the
 * caller reads only that profile's rows (no baseline, no merging).
 */
import { SK_ACTIVE_RETIREMENT_PROFILE_ID } from "@/lib/constants/settings-keys";

/** Coerce an app_settings jsonb value to a profile id. Stored as a bare
 *  number (`1`), but tolerate a numeric string from older writes. */
export function toProfileId(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isInteger(raw)) return raw;
  if (typeof raw === "string" && /^\d+$/.test(raw)) return Number(raw);
  return null;
}

/**
 * The active profile id from already-loaded rows. Falls back to the lowest-id
 * profile when the setting is missing or stale; with no profile,
 * `buildEnginePayload` returns null and the retirement page blanks.
 */
export function resolveRetirementProfileIdFrom(
  appSettings: { key: string; value: unknown }[],
  profiles: { id: number }[],
): number | null {
  if (profiles.length === 0) return null;
  const validIds = new Set(profiles.map((p) => p.id));
  const configured = toProfileId(
    appSettings.find((s) => s.key === SK_ACTIVE_RETIREMENT_PROFILE_ID)?.value,
  );
  if (configured != null && validIds.has(configured)) return configured;
  return profiles.reduce((lowest, p) => (p.id < lowest.id ? p : lowest)).id;
}

/** Whether resolveRetirementProfileIdFrom had to fall back: there are
 *  profiles, but the setting doesn't name one of them. */
export function retirementProfileIsFallback(
  appSettings: { key: string; value: unknown }[],
  profiles: { id: number }[],
): boolean {
  const configured = toProfileId(
    appSettings.find((s) => s.key === SK_ACTIVE_RETIREMENT_PROFILE_ID)?.value,
  );
  return profiles.length > 0 && !profiles.some((p) => p.id === configured);
}

/**
 * The settings row holding a profile's household assumptions. `retirement_settings`
 * has one row per person per profile and their household columns can disagree, so
 * prefer the primary person's row (the one read as the household's).
 */
export function pickProfileSettingsRow<
  T extends { profileId: number | null; personId: number },
>(
  rows: T[],
  profileId: number | null,
  primaryPersonId: number | null,
): T | undefined {
  if (profileId == null) {
    return primaryPersonId != null
      ? rows.find((r) => r.personId === primaryPersonId)
      : rows[0];
  }
  const inProfile = rows.filter((r) => r.profileId === profileId);
  return (
    (primaryPersonId != null
      ? inProfile.find((r) => r.personId === primaryPersonId)
      : undefined) ??
    // Deterministic fallback — lowest personId, never array order.
    inProfile.reduce<T | undefined>(
      (best, r) => (best == null || r.personId < best.personId ? r : best),
      undefined,
    )
  );
}
