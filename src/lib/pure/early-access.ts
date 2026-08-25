/**
 * Early-access (Rule of 55 / Roth ordering rules) computation for the Tax
 * Buckets analysis tool.
 *
 * Two independent flags per balance slice — `penaltyFree` and `taxFree` —
 * never one collapsed "accessible" flag. Penalty-free and tax-free are
 * genuinely different IRS questions (e.g. Rule of 55 makes a Traditional
 * 401k withdrawal penalty-free, but it's still taxable income).
 */
import {
  RULE_OF_55_AGE,
  PENALTY_FREE_AGE,
  ROTH_CONVERSION_SEASONING_YEARS,
} from "@/lib/constants";

export type SeparationSource = "explicit" | "derived" | "unknown";

export type SeparationResolution = {
  /** Calendar year the person separated (or is projected to separate) from
   *  the employer funding this account. Null when unknown. */
  year: number | null;
  source: SeparationSource;
};

/**
 * Resolve the separation year for a 401k/403b account. Prefers the durable,
 * user-set `performanceAccounts.separationDate`. Otherwise derives a
 * *default* from linked jobs: each job's candidate year is its real
 * `endDate` (already separated) or, for a still-active job, the year implied
 * by the target retirement age — then takes the MAX across all candidates.
 * Taking the max (not "latest-ended, else fallback to active") is
 * deliberate: it must not prefer a job the person left at 45 over a
 * still-active job that separates at 55.
 */
export function resolveSeparationYear(input: {
  explicitSeparationYear: number | null;
  linkedJobs: { endDate: Date | null; isSpeculative: boolean }[];
  targetRetirementAge: number;
  birthYear: number;
}): SeparationResolution {
  if (input.explicitSeparationYear != null) {
    return { year: input.explicitSeparationYear, source: "explicit" };
  }
  // Do NOT filter to only currently-active jobs (filterActiveJobs()) or only
  // isActive contributionAccounts rows — a separated employer's job/link is
  // exactly the one likely to look "inactive," and it's exactly the
  // evidence Rule of 55 needs to see.
  const candidateJobs = input.linkedJobs.filter((j) => !j.isSpeculative);
  if (candidateJobs.length === 0) {
    return { year: null, source: "unknown" };
  }
  const projectedYear = input.birthYear + input.targetRetirementAge;
  const candidateYears = candidateJobs.map((j) =>
    j.endDate ? j.endDate.getFullYear() : projectedYear,
  );
  return { year: Math.max(...candidateYears), source: "derived" };
}

/** Rule of 55: separating from that plan's employer in or after the
 *  calendar year the person turns 55 grants permanent penalty-free access
 *  to that plan — regardless of whether it's their *current* job, and
 *  regardless of whether the plan has sat dormant since. */
export function isRuleOf55Eligible(
  separationYear: number,
  birthYear: number,
): boolean {
  return separationYear - birthYear >= RULE_OF_55_AGE;
}

export type EarlyAccessSlice = {
  label: string;
  amount: number;
  penaltyFree: boolean;
  taxFree: boolean;
};

/** Brokerage: always accessible without penalty (no age/employer gate at
 *  all); only the gain portion is taxable. */
export function computeBrokerageAccess(
  balance: number,
  costBasis: number,
): EarlyAccessSlice[] {
  const basis = Math.min(costBasis, balance);
  const growth = balance - basis;
  return [
    { label: "Basis", amount: basis, penaltyFree: true, taxFree: true },
    { label: "Growth", amount: growth, penaltyFree: true, taxFree: false },
  ];
}

/** Traditional IRA: no Rule-of-55 equivalent (SEPP/72(t) only, out of scope
 *  for v1) — a flat age-59½ gate, always taxable as ordinary income. */
export function computeTraditionalIraAccess(
  balance: number,
  currentAge: number,
): EarlyAccessSlice[] {
  return [
    {
      label: "Traditional IRA",
      amount: balance,
      penaltyFree: currentAge >= PENALTY_FREE_AGE,
      taxFree: false,
    },
  ];
}

/** Traditional (preTax) slice of a 401k/403b: always taxable, but
 *  penalty-free once Rule-of-55-eligible for that specific account OR
 *  age ≥ 59½ — the same gate the Roth slice of the same account uses,
 *  since Rule of 55 frees the whole plan, not just part of it. */
export function computeEmployerPlanPreTaxAccess(
  balance: number,
  currentAge: number,
  ruleOf55Eligible: boolean,
): EarlyAccessSlice[] {
  return [
    {
      label: "Traditional",
      amount: balance,
      penaltyFree: ruleOf55Eligible || currentAge >= PENALTY_FREE_AGE,
      taxFree: false,
    },
  ];
}

/** Roth (taxFree) sub-election of a 401k/403b — IRS pro-rata rule: a
 *  distribution can't cleanly isolate basis, so the entered basis is only
 *  realized as a fraction of a *full* distribution. Both fractions share
 *  the same penalty-free gate (Rule of 55 frees the whole plan); only the
 *  basis fraction is tax-free. */
export function computeEmployerPlanRothAccess(
  balance: number,
  currentAge: number,
  ruleOf55Eligible: boolean,
  enteredBasis: number,
): EarlyAccessSlice[] {
  const penaltyFree = ruleOf55Eligible || currentAge >= PENALTY_FREE_AGE;
  const basisFraction = balance > 0 ? Math.min(enteredBasis, balance) : 0;
  const growthFraction = balance - basisFraction;
  return [
    {
      label: "Basis (pro-rata — realized only on a full distribution)",
      amount: basisFraction,
      penaltyFree,
      taxFree: true,
    },
    {
      label: "Growth (pro-rata)",
      amount: growthFraction,
      penaltyFree,
      taxFree: false,
    },
  ];
}

/** Roth IRA: real ordering rules apply — contribution basis is always
 *  penalty-free and tax-free with no clock; conversion basis is always
 *  tax-free but penalty-free only once its own 5-year clock has passed
 *  (gated conservatively on the *latest* tracked conversion year); growth
 *  needs age ≥ 59½ for both flags (v1 approximates "qualified" as this age
 *  check alone — no per-conversion clock beyond latestConversionYear). */
export function computeRothIraAccess(input: {
  balance: number;
  currentAge: number;
  currentYear: number;
  contributionBasis: number;
  conversionBasis: number;
  latestConversionYear: number | null;
}): EarlyAccessSlice[] {
  const {
    balance,
    currentAge,
    currentYear,
    contributionBasis,
    conversionBasis,
    latestConversionYear,
  } = input;
  const cappedContribution = Math.max(0, Math.min(contributionBasis, balance));
  const cappedConversion = Math.max(
    0,
    Math.min(conversionBasis, balance - cappedContribution),
  );
  const growth = balance - cappedContribution - cappedConversion;
  const conversionSeasoned =
    latestConversionYear != null &&
    currentYear - latestConversionYear >= ROTH_CONVERSION_SEASONING_YEARS;
  const qualified = currentAge >= PENALTY_FREE_AGE;

  const slices: EarlyAccessSlice[] = [
    {
      label: "Contribution basis",
      amount: cappedContribution,
      penaltyFree: true,
      taxFree: true,
    },
  ];
  if (cappedConversion > 0) {
    slices.push({
      label: "Conversion basis",
      amount: cappedConversion,
      penaltyFree: conversionSeasoned,
      taxFree: true,
    });
  }
  slices.push({
    label: "Growth",
    amount: growth,
    penaltyFree: qualified,
    taxFree: qualified,
  });
  return slices;
}
