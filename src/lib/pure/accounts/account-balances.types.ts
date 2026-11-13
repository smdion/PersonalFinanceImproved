/** The engine's account inputs and per-year balances (tax buckets,
 *  individual accounts). */

import type { AccountCategory } from "@/lib/config/account-types";
import type { AccountBalance } from "@/lib/config/account-types.types";
import type { EligibilityReason } from "@/lib/config/eligibility-reason";
import type { SeparationSource } from "@/lib/pure/accounts/early-access";
import type { AccountKey } from "@/lib/pure/accounts/account-part";

export type RothBasisMeta = {
  year: number;
  contributionBasis: number;
  conversionBasis: number;
  latestConversionYear: number | null;
  isSeeded: boolean;
  /** `Date` server-side, ISO `string` once serialized to the client (no superjson);
   *  nothing in this module or the projection reads it. */
  updatedAt: Date | string;
};

export type RuleOf55Status = {
  eligible: boolean | null; // null = unknown (no separation data)
  separationYear: number | null;
  source: SeparationSource;
  /** Only when source is "active": the earliest known non-speculative future endDate
   *  among linked jobs, capping the "at retirement" assumed separation; else null. */
  knownFutureSeparationYear: number | null;
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
 * Per-account balances by waterfall category and tax treatment (401k and IRA
 * kept apart). Each entry's shape follows its type's `balanceStructure` config.
 */
export type AccountBalances = Record<AccountCategory, AccountBalance>;

/** Individual account input for per-account engine tracking. */
export type IndividualAccountInput = {
  /** Display name (e.g. "Alice HSA", "Bob Roth IRA"). */
  name: string;
  /** The account's performance account, only when this part has exactly one. */
  performanceAccountId?: number;
  /** Waterfall category this account belongs to. */
  category: AccountCategory;
  /** Tax type: 'taxFree' for Roth, 'preTax'/'hsa'/'afterTax' for others. */
  taxType: string;
  /** Raw account type from DB (e.g. "401k", "IRA Traditional", "ESPP"). */
  accountType?: string;
  /** Starting balance from portfolio snapshot. */
  startingBalance: number;
  /** The household's chosen account for reinvested RMD money (Retirement
   *  settings) — resolved by the payload; at most one account. */
  rmdExcessTarget?: boolean;
  /** Absent: a held account. "declared": a $0 sibling of one, shown once it
   *  holds money; "projected": the projection-only Retirement brokerage;
   *  "synthetic": no real account behind it, the household's rules, no rows. */
  origin?: "declared" | "projected" | "synthetic";
  /** Starting cost basis (brokerage-type accounts), from the account's own
   *  `cost_basis`. Absent: the engine shares the aggregate basis out by
   *  balance. */
  startingBasis?: number;
  /** Owner person name (from DB lookup). */
  ownerName?: string;
  /** Owner person ID (from DB). Used for ID-based matching to contribution specs. */
  ownerPersonId?: number;
  /** Parent category from contribution account config (e.g. "Retirement", "Portfolio"). */
  parentCategory?: string;
  /** "Now" Rule of 55 / separation status; only for 401k/403b-type accounts
   *  (`rothOrderingRules === "pro_rata"`) with a resolvable owner. Future years
   *  are re-evaluated by `projectRuleOf55`, never read from this. */
  ruleOf55?: RuleOf55Status | null;
  /** Companion to `ruleOf55` — Roth contribution/conversion basis "now",
   *  same scope/caveats; seeds tracked Roth basis. */
  rothBasisMeta?: RothBasisMeta | null;
  /** `ownerPersonId`'s birth year, carried here because no complete personId→birth
   *  year map exists in `EngineInput`; the withdrawal-eligibility gate reads it. */
  ownerBirthYear?: number;
  /** The owner's planned retirement year (birth year + retirement age) —
   *  when a still-active job is assumed to end, for Rule of 55. */
  ownerRetirementYear?: number;
  /** Forces the projected Rule of 55 verdict to ineligible for this owner (the 59½
   *  path still applies; see `projectRuleOf55`'s `opts.forceIneligible`). Only ever
   *  `true`, omitted otherwise so the projection-cache hash stays stable. */
  ruleOf55ForceIneligible?: boolean;
  /** Household accepts the early-withdrawal penalty on this account: its exposed
   *  balance is routable in normal order (not last resort). Only ever `true`, omitted
   *  otherwise (hash stability); read by `computeWithdrawalEligibility`. */
  allowPenalizedWithdrawals?: boolean;
};

/** Per-account balance tracked through the engine projection. */
export type IndividualAccountYearBalance = {
  /** The part's identity (`accountKeyOf`): joins rows across years and views. */
  accountKey: AccountKey;
  /** As on `IndividualAccountInput`: only when the part has exactly one. */
  performanceAccountId?: number;
  name: string;
  category: AccountCategory;
  taxType: string;
  ownerName?: string;
  /** Owner person ID (from DB). Used for ID-based person filtering. */
  ownerPersonId?: number;
  /** Parent category from contribution account config (e.g. "Retirement", "Portfolio"). */
  parentCategory?: string;
  /** The projection-only retirement brokerage (`origin: "projected"`);
   *  rows appear only once it holds money. */
  projectedOnly?: boolean;
  balance: number;
  /** Cost basis (brokerage-type accounts), tracked per account by the
   *  engine (brokerage-basis.ts). */
  costBasis?: number;
  contribution: number;
  employerMatch: number;
  growth: number;
  /** Breakdown of contribution sources (brokerage accounts only). */
  intentionalContribution?: number;
  overflowContribution?: number;
  rampContribution?: number;
  /** The year's draw from this account and the eligibility it ran under:
   *  every retirement year, and a year a paycheck is gone (gap-year-draw.ts).
   *  Absent in an accumulation year with no draw. */
  draw?: AccountYearDraw;
  /** Tracked Roth basis, only for taxFree-bucket accounts with tracked basis;
   *  absent (not zero) otherwise so "no data" never reads as "$0 left". */
  roth?: AccountYearRothBasis;
};

/** One account's draw this year (`IndividualAccountYearBalance.draw`). */
export type AccountYearDraw = {
  /** Per-account withdrawal amount. */
  withdrawal: number;
  /** `true` = the full balance was treated as locked when routing ran this year
   *  (see `eligibility.ts`). `reason` is from `AccountEligibility.reason`; absent
   *  with no eligibility question for this category (brokerage: reason, never locked). */
  eligibilityLocked?: boolean;
  reason?: EligibilityReason;
  /** Start-of-year dollars drawable this year without the early-withdrawal
   *  penalty, and those that aren't (before this year's withdrawals and
   *  growth — the numbers routing used). */
  penaltyFreeAmount?: number;
  penaltyExposedAmount?: number;
  /** The household lets this account take penalized draws. */
  allowPenalizedWithdrawals?: boolean;
};

/** One account's tracked Roth basis (`IndividualAccountYearBalance.roth`). */
export type AccountYearRothBasis = {
  /** Tracked Roth basis remaining at END of this year, both phases.
   *  Contribution + conversion basis combined. */
  basisRemaining?: number;
  /** `basisRemaining`'s two parts, as the engine tracked them. */
  contributionBasisRemaining?: number;
  conversionBasisRemaining?: number;
  /** Basis dollars THIS year's withdrawal actually consumed (retirement
   *  years and gap years) — the portion that was basis, not growth. */
  basisDrawn?: number;
  /** True when `basisRemaining` rests on a stale (pre-projection) or
   *  auto-seeded, never-reviewed `account_basis` row — the figure may
   *  understate real basis, never overstate it. */
  basisUncertain?: boolean;
};
