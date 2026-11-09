/**
 * `buildSettingsPatch`: the 6 anchor fields every `retirementSettings.upsert` call must send
 * (personId, retirementAge, endAge, returnAfterRetirement, annualInflation, salaryAnnualIncrease).
 */
import type { Settings, SettingsPatch, UpsertSettingsInput } from "./types";

/**
 * Build the settings mutation payload.
 *
 * Always includes the 6 required anchor fields from `current`; spreads
 * `patch` on top so the caller only specifies what changed.
 */
export function buildSettingsPatch(
  current: Settings,
  patch: SettingsPatch,
): UpsertSettingsInput {
  return {
    personId: current.personId,
    // Always forwarded so the write scopes to the profile these values came
    // from, not the active one; retirementSettings.upsert
    // (routers/retirement/settings.ts) says why the key's presence matters.
    profileId: current.profileId,
    retirementAge: current.ownRetirementAge,
    endAge: current.ownEndAge,
    returnAfterRetirement: current.returnAfterRetirement,
    annualInflation: current.annualInflation,
    salaryAnnualIncrease: current.salaryAnnualIncrease,
    ...patch,
  };
}
