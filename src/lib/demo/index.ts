import type { DemoProfile } from "./types";
import { singleIncomeProfile } from "./profiles/single-income";
import { dualIncomeFamilyProfile } from "./profiles/dual-income-family";
import { earlyRetirementProfile } from "./profiles/early-retirement";
import { debtPayoffProfile } from "./profiles/debt-payoff";
import { recentlyRetiredProfile } from "./profiles/recently-retired";

export type { DemoProfile } from "./types";

/** All demo profiles, keyed by slug. */
export const DEMO_PROFILES: Record<string, DemoProfile> = {
  "single-income": singleIncomeProfile,
  "dual-income-family": dualIncomeFamilyProfile,
  "early-retirement": earlyRetirementProfile,
  "debt-payoff": debtPayoffProfile,
  "recently-retired": recentlyRetiredProfile,
};

/** Ordered list of profile slugs for display. */
export const DEMO_PROFILE_ORDER = [
  "single-income",
  "dual-income-family",
  "early-retirement",
  "debt-payoff",
  "recently-retired",
] as const;

/** Get profile metadata for listing (without full dataset). */
export function getDemoProfileList() {
  return DEMO_PROFILE_ORDER.map((slug) => {
    const p = DEMO_PROFILES[slug]!;
    return {
      slug: p.slug,
      name: p.name,
      description: p.description,
      keyStats: p.keyStats,
    };
  });
}
