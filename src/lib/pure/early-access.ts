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
  HSA_NON_MEDICAL_PENALTY_AGE,
} from "@/lib/constants";
import { roundToCents } from "@/lib/utils/math";

export type SeparationSource = "explicit" | "derived" | "active" | "no_data";

export type SeparationResolution = {
  /** Calendar year the person actually separated from the employer funding
   *  this account. Null when not yet separated (still employed there) or
   *  when there's no data to resolve it at all — NEVER a hypothetical
   *  future year. Rule of 55 requires separation to have already happened;
   *  a plan to retire at some target age someday is not evidence of that. */
  year: number | null;
  source: SeparationSource;
};

/**
 * Resolve the separation year for a 401k/403b account — "now," using only
 * real, already-happened separations. Prefers the durable, user-set
 * `performanceAccounts.separationDate`. Otherwise derives from linked jobs'
 * real `endDate`s that have actually passed as of `currentDate`. A linked
 * job with no `endDate` (or one in the future) is still-employed, not
 * "unknown" — reported distinctly as `source: "active"` since it's real,
 * known information (just not separation evidence), not a data gap.
 */
export function resolveSeparationYear(input: {
  explicitSeparationYear: number | null;
  linkedJobs: { endDate: Date | null; isSpeculative: boolean }[];
  currentDate: Date;
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
    return { year: null, source: "no_data" };
  }
  // getUTCFullYear(), not getFullYear() — endDate is a date-only DB column
  // (no real time-of-day), parsed as UTC midnight; reading it back in local
  // time can shift Jan-1-adjacent dates into the wrong year.
  const endedYears = candidateJobs
    .filter((j) => j.endDate != null && j.endDate <= input.currentDate)
    .map((j) => j.endDate!.getUTCFullYear());
  if (endedYears.length === 0) {
    return { year: null, source: "active" };
  }
  return { year: Math.max(...endedYears), source: "derived" };
}

/** Rule of 55: separating from that plan's employer in or after the
 *  calendar year the person turns 55 grants permanent penalty-free access
 *  to that plan — regardless of whether it's their *current* job, and
 *  regardless of whether the plan has sat dormant since. Only meaningful
 *  once separation has actually happened (see resolveSeparationYear). */
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

/**
 * Penalty-free capacity = the sum of the LEADING, CONTIGUOUSLY penalty-free
 * PREFIX of an account's slices, in the order its own distribution
 * ordering rules release them. NOT the sum of every penalty-free slice
 * regardless of position: a Roth IRA's ordering forces dollars out
 * contribution → conversion → growth, and an unseasoned conversion slice
 * (`penaltyFree: false`) blocks access to any penalty-free slice behind it
 * even if one existed. Today the prefix rule and a naive "sum every
 * penalty-free slice" rule happen to coincide for every account shape this
 * engine models (a pre-59½ owner always has penalized growth behind any
 * unseasoned conversion anyway) — the prefix rule is implemented regardless
 * of that coincidence, because summing would be wrong the moment a shape
 * existed where it mattered.
 *
 * Lives here (next to `EarlyAccessSlice`), not inside
 * `withdrawal-eligibility.ts`, specifically so the Tax Buckets UI can
 * import it directly rather than re-deriving "accessible now" with its own
 * sum-every-penalty-free-slice loop — a real second definition of this
 * quantity that happened to agree with the prefix rule for every shape
 * shipped so far only by the same coincidence this docblock already warns
 * about.
 */
export function penaltyFreePrefixAmount(slices: EarlyAccessSlice[]): number {
  let sum = 0;
  for (const s of slices) {
    if (!s.penaltyFree) break;
    sum += s.amount;
  }
  return roundToCents(sum);
}

/** Brokerage: always accessible without penalty (no age/employer gate at
 *  all); only the gain portion is taxable. */
export function computeBrokerageAccess(
  balance: number,
  costBasis: number,
): EarlyAccessSlice[] {
  const basis = Math.min(costBasis, balance);
  const growth = balance - basis;
  return [
    { label: "Cost basis", amount: basis, penaltyFree: true, taxFree: true },
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

/** HSA: modeled as general retirement spending money, not qualified medical
 *  expenses — deliberately NOT assuming the tax-free-for-medical treatment,
 *  even though that's real and available. Under that assumption, an HSA
 *  behaves exactly like a Traditional IRA: penalty-free at 65 (this
 *  account's own age gate, not the 59½ IRA one), always ordinary income
 *  tax. No basis concept, so no split — the whole balance moves together. */
export function computeHsaAccess(
  balance: number,
  currentAge: number,
): EarlyAccessSlice[] {
  return [
    {
      label: "HSA (general retirement spending)",
      amount: balance,
      penaltyFree: currentAge >= HSA_NON_MEDICAL_PENALTY_AGE,
      taxFree: false,
    },
  ];
}
