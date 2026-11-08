import type { DemoProfile } from "./types";
import { formatCurrency } from "@/lib/utils/format";
import { singleIncomeProfile } from "./profiles/single-income";
import { dualIncomeFamilyProfile } from "./profiles/dual-income-family";
import { earlyRetirementProfile } from "./profiles/early-retirement";
import { debtPayoffProfile } from "./profiles/debt-payoff";
import { recentlyRetiredProfile } from "./profiles/recently-retired";
import {
  DEMO_PROFILE_SLUGS,
  isDemoProfileSlug,
  type DemoProfileSlug,
} from "./slugs";

export type { DemoProfile } from "./types";
export {
  demoSchemaName,
  isDemoProfileSlug,
  type DemoProfileSlug,
} from "./slugs";

const PROFILES = {
  "single-income": singleIncomeProfile,
  "dual-income-family": dualIncomeFamilyProfile,
  "early-retirement": earlyRetirementProfile,
  "debt-payoff": debtPayoffProfile,
  "recently-retired": recentlyRetiredProfile,
} satisfies Record<DemoProfileSlug, DemoProfile>;

/** All demo profiles, keyed by slug. */
export const DEMO_PROFILES: Record<string, DemoProfile> = PROFILES;

/** The demo profile `slug` names, or null when it names none. */
export function getDemoProfile(slug: string): DemoProfile | null {
  return isDemoProfileSlug(slug) ? PROFILES[slug] : null;
}

/** The chooser card's stats: income (current jobs' salaries) and portfolio
 *  size (the seeded portfolio accounts) from the profile's own rows, so they
 *  can't disagree with what its pages show; the savings rate as stored. */
export function demoKeyStats(p: DemoProfile) {
  const current = p.jobs.filter((j) => j.endDate === null);
  const income = current.reduce((s, j) => s + Number(j.annualSalary), 0);
  const retired = current.length === 0 && p.jobs.length > 0;
  return {
    income: `${formatCurrency(income, 0)}${retired ? " (retired)" : ""}`,
    portfolioSize: formatCurrency(
      p.portfolioAccounts.reduce((s, a) => s + Number(a.amount), 0),
      0,
    ),
    savingsRate: p.keyStats.savingsRate,
  };
}

/** Get profile metadata for listing (without full dataset). */
export function getDemoProfileList() {
  return DEMO_PROFILE_SLUGS.map((slug) => {
    const p = DEMO_PROFILES[slug]!;
    return {
      slug: p.slug,
      name: p.name,
      description: p.description,
      keyStats: demoKeyStats(p),
    };
  });
}
