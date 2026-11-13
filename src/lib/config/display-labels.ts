// Consolidated display label maps.
// Components import from here — never define local label maps.

import type { ContribResolutionStatus } from "@/lib/pure/household/profiles";
import { WEALTH_TIER_PAW_MIN, WEALTH_TIER_UAW_MAX } from "@/lib/constants";
import {
  filingTable,
  parseReturnFilingStatus,
  type ReturnFilingStatusSpelling,
} from "@/lib/config/filing-status";
import type {
  CompositionBucket,
  InvestmentTransactionKind,
  PayPeriod,
} from "./enum-values";
import { isPayPeriod } from "./pay-periods";
import { BUDGET_SERVICES, isBudgetApiService } from "./budget-apps";

export const PAY_PERIOD_LABELS: Record<PayPeriod, string> = {
  weekly: "Weekly",
  biweekly: "Biweekly",
  semimonthly: "Semimonthly",
  monthly: "Monthly",
};
/** The label for a stored pay period; an unknown one is shown as stored. */
export function payPeriodLabel(payPeriod: string): string {
  return isPayPeriod(payPeriod) ? PAY_PERIOD_LABELS[payPeriod] : payPeriod;
}

/** A contribution view's period: its option label and an amount's suffix. */
export const CONTRIBUTION_PERIOD_TEXT = {
  paycheck: { label: "Per paycheck", suffix: "/paycheck" },
  monthly: { label: "Monthly", suffix: "/mo" },
  annual: { label: "Annual", suffix: "/yr" },
} as const;

/** "Bonus goes to" choices (Salary Profile entry `bonusDestination`). */
export const BONUS_DESTINATION_OPTIONS = [
  { value: "budget", label: "Budget" },
  { value: "spending", label: "Extra spending" },
] as const;

/** Which biweekly payday week a job is on. */
export const PAY_WEEK_LABELS: Record<string, string> = {
  even: "Even weeks",
  odd: "Odd weeks",
  na: "—",
};

export const CONTRIBUTION_METHOD_LABELS: Record<string, string> = {
  percent_of_salary: "% of Salary",
  fixed_per_period: "Fixed/Period",
  fixed_monthly: "Fixed/Month",
  fixed_annual: "Fixed/Year",
};

/** Shorter method labels used in the paycheck view. */
export const CONTRIBUTION_METHOD_LABELS_SHORT: Record<string, string> = {
  percent_of_salary: "% of salary",
  fixed_per_period: "$/period",
  fixed_monthly: "$/month",
  fixed_annual: "$/year",
};

export const TAX_TREATMENT_LABELS: Record<string, string> = {
  pre_tax: "Traditional",
  tax_free: "Roth",
  after_tax: "After-tax",
  hsa: "HSA",
};

/** The same four treatments by their camel-case key (balances, charts). */
export const TAX_TYPE_LABELS: Record<string, string> = {
  preTax: "Traditional",
  taxFree: "Roth",
  hsa: "HSA",
  afterTax: "After-tax",
};

/** Display label for tax treatment (e.g. `taxFree` → `Tax-Free`) */
export function taxTypeLabel(taxType: string): string {
  return TAX_TYPE_LABELS[taxType] ?? taxType;
}

export const EMPLOYER_MATCH_LABELS: Record<string, string> = {
  none: "No match",
  percent_of_contribution: "% of contribution",
  dollar_match: "$ match",
  fixed_annual: "Fixed annual",
};

/** A contribution card's no-match option: "not recognised" when the stored match
 *  type is outside the set (read as no match). */
export function noEmployerMatchLabel(
  row: { matchTypeUnrecognised?: true },
  matchedElsewhere: boolean,
): string {
  if (row.matchTypeUnrecognised) return "Match type not recognised";
  return matchedElsewhere ? "No match config of its own" : "No employer match";
}

/** Unit glyph for a match type's value field; null for "none". Display-only: never use it
 *  for %-to-decimal math. The cap check stays an inline `"percent_of_contribution"` test
 *  so a new type with a cap can't inherit its ×100/÷100 conversion. */
export const EMPLOYER_MATCH_VALUE_UNIT: Record<string, "%" | "$" | null> = {
  none: null,
  percent_of_contribution: "%",
  dollar_match: "$",
  fixed_annual: "$",
};

/** Budget "PC" badge text for a linked item, per how it resolved for the column viewed.
 *  "ok" keeps the plain "PC"; the others name the cause on the badge itself. */
export const CONTRIB_RESOLUTION_LABELS: Record<
  ContribResolutionStatus,
  string
> = {
  ok: "PC",
  not_in_profile: "Not Set",
  inactive_in_profile: "Off",
  inactive_in_sandbox: "Off (What-If)",
  no_pay_period: "Incomplete",
  account_unavailable: "Unavailable",
};

export const CONTRIB_RESOLUTION_TOOLTIPS: Record<
  ContribResolutionStatus,
  string
> = {
  ok: "",
  not_in_profile:
    "The Contribution Profile in use has no value set for this account — $0 here, not a guessed amount.",
  inactive_in_profile:
    "Turned off in the Contribution Profile in use — $0 here, not a guessed amount.",
  inactive_in_sandbox: "Turned off in What-If — $0 in this sandbox only.",
  no_pay_period:
    "Linked contribution account has no resolvable pay period (missing/ended job) — excluded from this total, not defaulted.",
  account_unavailable:
    "Linked contribution account is inactive or was deleted.",
};

export const MATCH_TAX_LABELS: Record<string, string> = {
  pre_tax: "Traditional",
  tax_free: "Roth",
};

export const HSA_COVERAGE_LABELS: Record<string, string> = {
  self_only: "Self Only",
  family: "Family",
};

/** Tooltip descriptions for tax bucket columns in the contribution engine table. */
export const TAX_BUCKET_DESCRIPTIONS: Record<string, string> = {
  preTax:
    "Traditional (pre-tax) contributions + employer match. Taxed on withdrawal.",
  taxFree: "Roth (tax-free) contributions. Tax-free on withdrawal.",
  hsa: "HSA contributions. Triple tax-advantaged.",
  afterTax: "After-tax brokerage contributions. Capital gains tax on growth.",
};

/** Short tax treatment labels for compact display (contribution profiles, badges). */
const TAX_TREATMENT_SHORT_LABELS: Record<string, string> = {
  pre_tax: "Trad",
  tax_free: "Roth",
  after_tax: "After-tax",
  hsa: "HSA",
  // Engine-internal keys (used in projection overrides taxTypeCaps)
  traditional: "Trad",
  roth: "Roth",
};

/** Get short label for a tax treatment value. */
export function taxTreatmentToShortLabel(taxTreatment: string): string {
  return TAX_TREATMENT_SHORT_LABELS[taxTreatment] ?? taxTreatment;
}

/**
 * Performance display category config — maps account types to performance page groupings.
 * "401k/IRA" covers 401k, 403b, and IRA accounts.
 */
const PERF_CATEGORY_MAP: Record<string, string> = {
  brokerage: "Brokerage",
  hsa: "HSA",
};

/** Default performance category for account types not in PERF_CATEGORY_MAP. */
export const PERF_CATEGORY_DEFAULT = "401k/IRA";

/** Performance category for brokerage accounts. */
export const PERF_CATEGORY_BROKERAGE = "Brokerage";

/** Performance category for HSA accounts. */
export const PERF_CATEGORY_HSA = "HSA";

/** Performance category for the combined Portfolio view. */
export const PERF_CATEGORY_PORTFOLIO = "Portfolio";

/** Performance category for the combined Retirement rollup. */
export const PERF_CATEGORY_RETIREMENT = "Retirement";

/** Canonical display order for performance categories (tabs, finalize modal, etc.). */
export const PERF_CATEGORY_DISPLAY_ORDER = [
  PERF_CATEGORY_PORTFOLIO,
  PERF_CATEGORY_RETIREMENT,
  PERF_CATEGORY_DEFAULT,
  PERF_CATEGORY_BROKERAGE,
  PERF_CATEGORY_HSA,
] as const;

/** Union of all valid performance-category display strings. */
export type PerfCategory = (typeof PERF_CATEGORY_DISPLAY_ORDER)[number];

/** Derive performance page display category from accountType string. */
export function accountTypeToPerformanceCategory(
  accountType: string | null,
): string {
  return (
    (accountType && PERF_CATEGORY_MAP[accountType]) ?? PERF_CATEGORY_DEFAULT
  );
}

/**
 * Performance categories whose accounts are entirely Retirement-parentCategory.
 * Brokerage is excluded because it spans both Retirement and Portfolio goals.
 */
export const FULLY_RETIREMENT_PERF_CATEGORIES = [
  PERF_CATEGORY_DEFAULT,
  PERF_CATEGORY_HSA,
] as const;

/** Parent-category rollup names used in performance data. */
export const PARENT_CATEGORY_ROLLUPS = ["Retirement", "Portfolio"] as const;

/** HelpTip for the cash-basis annotation (gainLoss + employer contributions) on a
 *  discount-kind account such as ESPP, where the employer amount is a discount, not cash. */
export const CASH_BASIS_HELP =
  "vs. cash paid — ESPP shares are purchased at a discount, so this figure measures against what was actually paid rather than full market value.";

/** Combine a Gain/Loss figure with the discount-only portion of employer
 *  contributions to get the cash-basis Gain/Loss. Single source of truth so
 *  this formula can't silently diverge between the pages that show it. */
export function combineCashBasisGainLoss(
  gainLoss: number,
  discountEmployerSum: number,
): number {
  return gainLoss + discountEmployerSum;
}

/** Generic label lookup with fallback to key. */
export function displayLabel(map: Record<string, string>, key: string): string {
  return map[key] ?? key;
}

// ---------------------------------------------------------------------------
// Wealth score tier labels (shared by MetricsRow + Financial Checkup)
// ---------------------------------------------------------------------------

type WealthTier = "paw" | "aaw" | "uaw";

/** Derive the wealth tier and display label from a wealth-formula score
 *  (net worth ÷ expected net worth). PAW at 2× or more, UAW at ½ or less,
 *  AAW in between — The Millionaire Next Door's bands. */
export function wealthScoreTier(aawScore: number): {
  tier: WealthTier;
  label: string;
  shortLabel: string;
} {
  if (aawScore >= WEALTH_TIER_PAW_MIN) {
    return {
      tier: "paw",
      label: "PAW — Prodigious Accumulator",
      shortLabel: "PAW — Prodigious",
    };
  }
  if (aawScore > WEALTH_TIER_UAW_MAX) {
    return {
      tier: "aaw",
      label: "AAW — Average Accumulator",
      shortLabel: "AAW — Average",
    };
  }
  return {
    tier: "uaw",
    label: "UAW — Under Accumulator",
    shortLabel: "UAW — Under",
  };
}

// ---------------------------------------------------------------------------
// Milestone statuses (Milestones page)
// ---------------------------------------------------------------------------

export const MILESTONE_STATUS_LABELS: Record<
  "reached" | "onTrack" | "behind" | "unknown",
  string
> = {
  reached: "Reached",
  onTrack: "On track",
  behind: "Behind",
  unknown: "Not enough data",
};

/** Investment transaction kinds, as shown in Settings → Integrations → SimpleFIN. */
export const INVESTMENT_TRANSACTION_KIND_LABELS: Record<
  InvestmentTransactionKind,
  string
> = {
  contribution: "Contribution",
  withdrawal: "Withdrawal",
  dividend: "Dividend",
  interest: "Interest",
  fee: "Fee",
  trade: "Trade (inside the account)",
  sweep: "Cash sweep (inside the account)",
  gain_loss: "Realized gain/loss",
  transfer: "Transfer between your accounts",
  other: "Other",
};

/** Composition buckets of a fund's holdings. */
export const COMPOSITION_BUCKET_LABELS: Record<CompositionBucket, string> = {
  us_equity: "US stocks",
  intl_equity: "International stocks",
  us_bond: "US bonds",
  intl_bond: "International bonds",
  tips: "TIPS",
  cash: "Cash",
  other: "Other",
};

/** The projection-only retirement brokerage the engine declares when the
 *  household has no Retirement brokerage (engine/opening-state.ts). */
export const PROJECTED_RETIREMENT_BROKERAGE_LABEL =
  "Retirement brokerage (projected)";

/** Where penalty-free money sits at the start of the retirement bridge
 *  (lib/pure/retirement/retirement-bridge.ts). */
export const BRIDGE_SOURCE_LABELS: Record<
  "brokerage" | "roth" | "workplacePlan" | "traditionalIra" | "other",
  string
> = {
  brokerage: "Brokerage",
  roth: "Roth",
  workplacePlan: "Workplace plan (Rule of 55)",
  traditionalIra: "Traditional IRA",
  other: "Other",
};

/** How each filing status reads on screen — never the short code. Ledgr
 *  has no married-filing-separately status. */
export const FILING_STATUS_LABELS: Record<ReturnFilingStatusSpelling, string> =
  {
    MFJ: "Married filing jointly",
    Single: "Single",
    HOH: "Head of household",
    QSS: "Qualifying surviving spouse",
  };
/** The label for a stored status; an unknown one is shown as stored. */
export function filingStatusLabel(status: string): string {
  const known = parseReturnFilingStatus(status);
  return known ? filingTable(FILING_STATUS_LABELS, known) : status;
}

/** Where a filing status not saved for the household came from (the
 *  sources lib/pure/tax/filing-status.ts names besides "household"). */
export const FILING_STATUS_SOURCE_LABELS: Record<
  "retirementProfile" | "w4",
  string
> = {
  retirementProfile: "the Retirement Profile",
  w4: "the W-4",
};

/** Display label for a budget API service, so sync toasts name the connected
 *  provider. */
export function budgetApiServiceLabel(
  service: string | null | undefined,
): string {
  if (isBudgetApiService(service)) return BUDGET_SERVICES[service].label;
  if (service === "simplefin") return "SimpleFIN";
  return "the budget API";
}

/** Why a joint account with no job refuses a percent: it has no pay of its own. */
export const JOINT_PERCENT_REFUSED = {
  salary:
    "Joint accounts using percent-of-salary contributions must be linked to a specific job",
  match:
    "A joint account with no job has no pay to match a percent of: use a dollar match, or tie it to a job.",
} as const;
