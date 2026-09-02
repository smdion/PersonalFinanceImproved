// Shared types used across multiple calculator domains.
// These are the building blocks that other domain files depend on.

import type {
  AccountCategory,
  AccountBalance,
} from "@/lib/config/account-types";
import type {
  RuleOf55Status,
  RothBasisMeta,
} from "@/lib/pure/tax-bucket-analysis";

export type ViewMode = "projected" | "blended" | "ytd";

export type PayPeriodType = "weekly" | "biweekly" | "semimonthly" | "monthly";
export type TaxTreatmentType = "pre_tax" | "tax_free" | "after_tax" | "hsa";
export type FilingStatusType = "MFJ" | "Single" | "HOH";

export type DeductionLine = {
  name: string;
  amount: number;
  taxTreatment: TaxTreatmentType;
  ficaExempt: boolean;
};

export type TaxBracketInput = {
  filingStatus: FilingStatusType;
  w4Checkbox: boolean; // whether this bracket set is the 2(c) checked version
  brackets: { min: number; max: number | null; rate: number }[];
  standardDeduction: number;
  /** Pub 15-T Worksheet 1A line 1g: the flat amount subtracted from
   *  annualized wages (line 1h) before the bracket lookup, when the W-4
   *  Step 2(c) box is unchecked. 0 when w4Checkbox is true (no worksheet
   *  adjustment applies — the 2(c) tables already assume it isn't taken).
   *  Withholding-only; annual tax liability (calculateTax) doesn't use it. */
  w4Adjustment: number;
  socialSecurityWageBase: number;
  socialSecurityRate: number;
  medicareRate: number;
  medicareAdditionalRate: number;
  medicareAdditionalThreshold: number;
};

export type ContributionAccountInput = {
  name: string;
  annualContribution: number;
  perPeriodContribution: number;
  /** Fractional rate of gross pay (e.g. 0.14 for 14%). Non-null only for
   *  percent_of_salary accounts — used to scale contributions against bonus
   *  gross rather than reusing the regular per-period dollar amount. */
  rateOfGross: number | null;
  taxTreatment: TaxTreatmentType;
  isPayrollDeducted: boolean;
  group: string; // e.g. 'retirement', 'portfolio' — driven by account data, not hardcoded
  employerMatch: number;
  employerMatchTaxTreatment: TaxTreatmentType;
};

/**
 * A one-time dollar-amount injection or withdrawal in a specific year.
 * NOT sticky-forward — only applied in the exact override year.
 * Bypasses IRS contribution limits (models rollovers, inheritances, etc.).
 */
export type LumpSum = {
  amount: number;
  targetAccount: AccountCategory;
  taxType?: "traditional" | "roth";
  /** Specific individual account name (e.g., "Long Term Brokerage (Vanguard)").
   *  When set, the engine adds the lump sum to this exact account in indBal. */
  targetAccountName?: string;
  /** Owner name of the targeted individual account (R4, v0.7.11) — two
   *  household members can independently choose the same account name (e.g.
   *  both "Long Term Brokerage"), and `targetAccountName` alone can't tell
   *  them apart. When set, the engine matches on (name, ownerName) before
   *  falling back to name alone, mirroring how `ContributionSpec.ownerName`
   *  already disambiguates the same collision for ongoing contributions
   *  (`individual-account-tracking.ts`'s `buildSpecToAccountMapping`).
   *  Undefined ⇒ name-only match, unchanged behavior for every lump sum
   *  saved before this field existed. */
  targetOwnerName?: string;
  label?: string;
};

/** Override salary or budget at a specific calendar year in the projection. */
export type RetirementYearOverride = {
  year: number;
  value: number;
  notes?: string;
};

/** Per-tax-bucket breakdown used throughout retirement projection */
export type TaxBuckets = {
  preTax: number;
  taxFree: number;
  hsa: number;
  afterTax: number;
  /** Cost basis of after-tax (brokerage) holdings. Only gains (afterTax - afterTaxBasis) are taxable on withdrawal. */
  afterTaxBasis: number;
};

/**
 * Per-account balance breakdown by waterfall category and tax treatment.
 * More granular than TaxBuckets — tracks 401k vs IRA separately so
 * decumulation routing uses real balances instead of heuristic splits.
 *
 * Each entry is a discriminated union (AccountBalance) whose shape is
 * determined by the account type's `balanceStructure` config property.
 */
export type AccountBalances = Record<AccountCategory, AccountBalance>;

/** Individual account input for per-account engine tracking. */
export type IndividualAccountInput = {
  /** Display name (e.g. "Alice HSA", "Bob Roth IRA"). */
  name: string;
  /** Waterfall category this account belongs to. */
  category: AccountCategory;
  /** Tax type: 'taxFree' for Roth, 'preTax'/'hsa'/'afterTax' for others. */
  taxType: string;
  /** Raw account type from DB (e.g. "401k", "IRA Traditional", "ESPP"). */
  accountType?: string;
  /** Starting balance from portfolio snapshot. */
  startingBalance: number;
  /** Owner person name (from DB lookup). */
  ownerName?: string;
  /** Owner person ID (from DB). Used for ID-based matching to contribution specs. */
  ownerPersonId?: number;
  /** Parent category from contribution account config (e.g. "Retirement", "Portfolio"). */
  parentCategory?: string;
  /** "Now" Rule of 55 / separation resolution for this account (v0.7.8,
   *  PLAN-v0.7.8-v4 Group 1.1) — only present for 401k/403b-type accounts
   *  (`accountType` config's `rothOrderingRules === "pro_rata"`) with a
   *  resolvable owner. The engine re-evaluates this for a future projected
   *  year itself via `projectRuleOf55`
   *  (`src/lib/pure/tax-bucket-projection.ts`) rather than trusting a
   *  precomputed "now" answer for a different year. Not yet consumed by
   *  the engine (Group 2 wires the withdrawal-ordering eligibility gate) —
   *  purely additive data threading in this pass. */
  ruleOf55?: RuleOf55Status | null;
  /** Companion to `ruleOf55` — Roth contribution/conversion basis "now",
   *  same scope/caveats. Not yet consumed (see above). */
  rothBasisMeta?: RothBasisMeta | null;
  /** `ownerPersonId`'s birth year (v0.7.8 Group 1.1) — carried directly on
   *  the account rather than requiring a separate personId→birthYear
   *  lookup at consumption time. No general "every household member's
   *  birth year, keyed by personId" map exists elsewhere in `EngineInput`:
   *  `perPersonBirthYears` is a positional array (no personId link), and
   *  `socialSecurityEntries`/`rmdStartAgeByPerson` are only populated for
   *  multi-person households. Attaching it here means the withdrawal-
   *  eligibility gate (Group 2) never depends on which of those partial
   *  sources happened to cover a given owner. */
  ownerBirthYear?: number;
  /** Rule of 55 forecasting override (v0.7.8) — per-person, forces the
   *  PROJECTED (future-year) Rule of 55 verdict to ineligible for this
   *  account's owner, regardless of what the real job-separation
   *  computation says. Only ever set `true` (never `false`) — omitted
   *  entirely for the default (no override) case, so every household not
   *  using this feature has a byte-identical engine input (and so an
   *  unchanged projection-cache hash — see `hashEngineInput` in
   *  `server/helpers/projection-cache.ts`). One-directional: can only push
   *  eligibility from true to false. See `projectRuleOf55`'s
   *  `opts.forceIneligible` docblock (`lib/pure/tax-bucket-projection.ts`)
   *  for the full contract, and why this is threaded as a parameter INTO
   *  that function rather than checked by either of its two callers —
   *  short-circuiting to "locked" in the consumer was a real bug caught in
   *  advisor review (Rule-of-55-ineligible isn't the same as locked; the
   *  59½ path must still apply). */
  ruleOf55ForceIneligible?: boolean;
  /** Household is fine paying the 10%/20% early-withdrawal penalty on THIS
   *  account when the projection needs to draw from it (R41). Makes this
   *  account's penalty-exposed balance normally withdrawable — NOT a
   *  strict last-resort guarantee; ordinary routing order still decides
   *  when it's drawn (see `performanceAccounts.allowPenalizedWithdrawals`'s
   *  docblock, `schema-pg.ts`, for the full contract and the tracked
   *  follow-up for true last-resort ordering). Only ever set `true` —
   *  omitted entirely for the default (no override) case, same cache-hash-
   *  stability convention as `ruleOf55ForceIneligible` above. Consumed by
   *  `computeWithdrawalEligibility` (`lib/pure/withdrawal-eligibility.ts`),
   *  which uses it to compute a second, narrower "still-excluded" aggregate
   *  that `subtractPenaltyExposed` (`lib/calculators/engine/balance-utils.ts`)
   *  subtracts instead of the category's full penalty-exposed total — this
   *  account's exposed dollars stay in the routable pool while every other
   *  account's stay excluded. */
  allowPenalizedWithdrawals?: boolean;
};

/** Per-account balance tracked through the engine projection. */
export type IndividualAccountYearBalance = {
  name: string;
  category: AccountCategory;
  taxType: string;
  ownerName?: string;
  /** Owner person ID (from DB). Used for ID-based person filtering. */
  ownerPersonId?: number;
  /** Parent category from contribution account config (e.g. "Retirement", "Portfolio"). */
  parentCategory?: string;
  balance: number;
  contribution: number;
  employerMatch: number;
  growth: number;
  /** Per-account withdrawal amount (decumulation only). */
  withdrawal?: number;
  /** Breakdown of contribution sources (brokerage accounts only). */
  intentionalContribution?: number;
  overflowContribution?: number;
  rampContribution?: number;
  /** Withdrawal-ordering eligibility for this account, this year
   *  (decumulation only; v0.7.8, PLAN-v0.7.8-v4 follow-up). `true` = the
   *  full balance was treated as locked (penalty-preferred-against) when
   *  withdrawal routing ran this year — never "inaccessible", the engine's
   *  soft/penalized-but-available model always allows drawing from a
   *  locked account once eligible sources run out (see
   *  `withdrawal-eligibility.ts`'s module docblock). `reason` explains why,
   *  from `AccountEligibility.reason`. Absent when the account has no
   *  resolvable eligibility question for this category (e.g. brokerage —
   *  though that case still gets a reason string, just never `locked`) or
   *  during accumulation. */
  eligibilityLocked?: boolean;
  eligibilityReason?: string;
  /** Tracked Roth basis remaining at END of this year, both phases
   *  (v0.7.8 tracked-basis follow-up — see
   *  `@/lib/pure/roth-basis-tracking`). Contribution + conversion basis
   *  combined. Present only for taxFree-bucket accounts; absent (not
   *  zero) for everything else, so "no data" is never confused with
   *  "$0 left". */
  rothBasisRemaining?: number;
  /** Basis dollars THIS year's withdrawal actually consumed (decumulation
   *  only) — the portion of the withdrawal that was basis, not growth. */
  rothBasisDrawn?: number;
  /** True when `rothBasisRemaining` rests on a stale (pre-projection) or
   *  auto-seeded, never-reviewed `account_basis` row — the figure may
   *  understate real basis, never overstate it. */
  rothBasisUncertain?: boolean;
};

/** Account category — auto-derived from ACCOUNT_TYPE_CONFIG keys. Re-exported for convenience. */
export type {
  AccountCategory,
  AccountBalance,
} from "@/lib/config/account-types";
