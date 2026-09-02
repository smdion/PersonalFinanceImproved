/**
 * Which Retirement Profile is active, resolved server-side.
 *
 * Retirement is the fourth profile axis alongside budget / contribution /
 * salary. On the client those resolve through `useEffectiveProfileId`
 * (Plan's choice → local selection → global active); server-side reads get
 * handed an id or fall back to the global active one, which is what this
 * does.
 *
 * ONE resolver, used by every read site (build-engine-payload, snapshot,
 * the retirement router), so "which assumptions am I reading" can't diverge
 * between the projection, the net-worth history, and the readiness analysis.
 *
 * Each profile is a complete world — there is no baseline profile and no
 * merging. This returns exactly one id, and the caller reads that profile's
 * rows and nothing else.
 */
import { asc } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { SK_ACTIVE_RETIREMENT_PROFILE_ID } from "@/lib/constants/settings-keys";
import type { Db } from "./transforms";

/** Coerce an app_settings jsonb value to a profile id. Stored as a bare
 *  number (`1`), but tolerate a numeric string from older writes. */
function toProfileId(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isInteger(raw)) return raw;
  if (typeof raw === "string" && /^\d+$/.test(raw)) return Number(raw);
  return null;
}

/**
 * Resolve the active profile id from already-loaded rows — the hot path, so
 * callers that already selected these tables don't issue extra queries.
 *
 * Falls back to the lowest-id profile when the setting is missing or points
 * at a deleted row. That fallback matters: without it a household whose
 * setting went stale resolves to no profile, and `buildEnginePayload`
 * returns null, which blanks the retirement page rather than degrading.
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

/**
 * Pick the one settings row that represents a profile's household assumptions.
 *
 * During the EXPAND phase `retirement_settings` is still one row per person,
 * and step A pointed every one of them at the same profile — so filtering by
 * `profileId` alone matches several rows, and the underlying SELECT has no
 * ORDER BY, so `.find()` would pick an arbitrary one.
 *
 * That is not academic. Household-grain columns are duplicated onto every
 * person's row and are free to DISAGREE, because only the primary person's
 * copy was ever read — a real household here had `withdrawal_rate` 0.0325 vs
 * 0.04 and `rmd_excess_handling` reinvest vs spend across its two rows.
 * Picking the wrong one silently moves every number in the projection (caught
 * 2026-08-30 by the golden gate, which is the whole reason it exists).
 *
 * So: prefer the primary person's row, exactly as the pre-migration code did.
 * Once the contract step collapses this to one row per profile, THAT row must
 * be built from the primary person's values for the same reason.
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

/** Query-issuing convenience wrapper for callers that haven't already
 *  loaded app_settings and retirement_profiles. */
export async function resolveRetirementProfileId(
  db: Db,
): Promise<number | null> {
  const [appSettings, profiles] = await Promise.all([
    db.select().from(schema.appSettings),
    db
      .select()
      .from(schema.retirementProfiles)
      .orderBy(asc(schema.retirementProfiles.id)),
  ]);
  return resolveRetirementProfileIdFrom(appSettings, profiles);
}
