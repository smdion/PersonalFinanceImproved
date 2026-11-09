/**
 * Early access (Rule of 55 / Roth ordering) for the Tax Buckets tool. Each slice carries
 * separate `penaltyFree` and `taxFree` flags: Rule of 55 makes Traditional 401k money
 * penalty-free but still taxable.
 */
import {
  RULE_OF_55_AGE,
  PENALTY_FREE_AGE,
  ROTH_CONVERSION_SEASONING_YEARS,
  HSA_NON_MEDICAL_PENALTY_AGE,
  HSA_NON_MEDICAL_PENALTY_RATE,
} from "@/lib/constants";
import type { EarlyAccessRule } from "@/lib/config/account-types.types";
import { assertNever } from "@/lib/utils/assert-never";
import { formatPercent } from "@/lib/utils/percent";
import { roundToCents } from "@/lib/utils/math";

export type SeparationSource = "explicit" | "derived" | "active" | "no_data";

type SeparationResolution = {
  /** Year the person actually separated from this account's employer; null when still
   *  employed there or unknown. Never a planned future year: Rule of 55 needs a real one. */
  year: number | null;
  source: SeparationSource;
};

/**
 * Separation year for a 401k/403b "now": the user-set `separationDate`, else linked jobs'
 * `endDate`s already past at `currentDate`. A linked job with no or a future `endDate` is
 * `source: "active"` (still employed), not a data gap.
 */
export function resolveSeparationYear(input: {
  explicitSeparationYear: number | null;
  linkedJobs: { endDate: Date | null; isSpeculative: boolean }[];
  currentDate: Date;
}): SeparationResolution {
  if (input.explicitSeparationYear != null) {
    return { year: input.explicitSeparationYear, source: "explicit" };
  }
  // Include inactive jobs and links: a separated employer's job looks inactive,
  // and it's exactly the evidence Rule of 55 needs.
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

/** Rule of 55: separating from the plan's employer in or after the year the person
 *  turns 55 grants permanent penalty-free access to that plan, current job or not.
 *  Only meaningful once separation has happened (see resolveSeparationYear). */
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
 * Sum of the leading, contiguous penalty-free slices in the account's release order: an
 * unseasoned Roth conversion slice blocks every slice behind it. Shared with the Tax Buckets UI.
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

/** Traditional (preTax) slice of a 401k/403b: always taxable; penalty-free once Rule of 55
 *  applies to this account or at 59½ (same gate as its Roth slice: it frees the whole plan). */
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

/** Roth sub-election of a 401k/403b, pro-rata: basis is realized only as a fraction of a
 *  full distribution. Both fractions share the plan's penalty-free gate; only the basis
 *  fraction is tax-free. */
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

/** Roth IRA ordering: contribution basis free always; conversion basis tax-free, penalty-free
 *  after the latest conversion's 5-year clock or at 59½; growth needs 59½ for both flags
 *  ("qualified" approximated by age alone). */
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
      // The 5-year conversion penalty applies only under 59½.
      penaltyFree: conversionSeasoned || qualified,
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

/**
 * One sentence for every surface showing an HSA draw: the engine treats each as non-medical
 * spending (as `computeHsaAccess` does), which can overstate tax.
 */
export const HSA_DRAW_TREATMENT = `Projected as non-medical: taxed as ordinary income, plus a ${formatPercent(HSA_NON_MEDICAL_PENALTY_RATE)} penalty before age ${HSA_NON_MEDICAL_PENALTY_AGE}. Money you spend on qualified medical costs would be tax- and penalty-free at any age, which the projection doesn't model, so it may overstate the tax.`;

/** HSA, modeled as non-medical spending (medical tax-free use not assumed): like a
 *  Traditional IRA, penalty-free at 65 and always ordinary income; no basis split. */
export function computeHsaAccess(
  balance: number,
  currentAge: number,
): EarlyAccessSlice[] {
  return [
    {
      label: "HSA (non-medical spending in retirement)",
      amount: balance,
      penaltyFree: currentAge >= HSA_NON_MEDICAL_PENALTY_AGE,
      taxFree: false,
    },
  ];
}

/** One account's slices under its type's early-access rule; null for a rule
 *  with no age or employer gate, where the whole balance is penalty-free. */
export function earlyAccessSlices(
  rule: EarlyAccessRule,
  account: {
    balance: number;
    currentAge: number;
    currentYear: number;
    isRoth: boolean;
    /** This account's Rule of 55 result for the year (employer plans). */
    ruleOf55Met: boolean;
    contributionBasis: number;
    conversionBasis: number;
    latestConversionYear: number | null;
  },
): EarlyAccessSlice[] | null {
  const { balance, currentAge, isRoth, ruleOf55Met } = account;
  switch (rule) {
    case "ira_59_half":
      return isRoth
        ? computeRothIraAccess(account)
        : computeTraditionalIraAccess(balance, currentAge);
    case "employer_plan":
      return isRoth
        ? computeEmployerPlanRothAccess(
            balance,
            currentAge,
            ruleOf55Met,
            account.contributionBasis + account.conversionBasis,
          )
        : computeEmployerPlanPreTaxAccess(balance, currentAge, ruleOf55Met);
    case "hsa_non_medical":
      return computeHsaAccess(balance, currentAge);
    case "none":
      return null;
    default:
      return assertNever(rule);
  }
}
