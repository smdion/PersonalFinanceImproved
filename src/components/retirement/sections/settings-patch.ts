/**
 * `buildSettingsPatch` — single source of truth for the 6-field required
 * anchor payload that every `retirementSettings.upsert` call must include.
 *
 * The tRPC upsert schema requires personId, retirementAge, endAge,
 * returnAfterRetirement, annualInflation, and salaryAnnualIncrease on every
 * call (they identify the row and prevent accidental field erasure). Without
 * a helper, each call site must repeat all six — ~16 sites × 6 fields = drift
 * risk if the required set ever changes.
 *
 * Usage:
 *   upsertSettings.mutate(buildSettingsPatch(settings, { withdrawalRate: '0.04' }))
 *
 * Created in v0.5.3 (Group E refactor). Pure extraction — no logic changes.
 */
import type { Settings, UpsertSettingsInput } from "./types";

/**
 * Build the settings mutation payload.
 *
 * Always includes the 6 required anchor fields from `current`; spreads
 * `patch` on top so the caller only specifies what changed.
 */
export function buildSettingsPatch(
  current: Settings,
  patch: Partial<Settings>,
): UpsertSettingsInput {
  return {
    personId: current.personId,
    retirementAge: current.retirementAge,
    endAge: current.endAge,
    returnAfterRetirement: current.returnAfterRetirement,
    annualInflation: current.annualInflation,
    salaryAnnualIncrease: current.salaryAnnualIncrease,
    ...patch,
  };
}
