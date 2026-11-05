// Shared types used across multiple calculator domains.
// These are the building blocks that other domain files depend on.

import type { AccountCategory } from "@/lib/config/account-types";
import type { AccountBalance } from "@/lib/config/account-types.types";
import type {
  RuleOf55Status,
  RothBasisMeta,
} from "@/lib/pure/accounts/tax-bucket-analysis";

export type * from "../paycheck/paycheck.types";
export type * from "../contributions/view-mode";

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
  /** Owner name of the targeted individual account — two
   *  household members can independently choose the same account name (e.g.
   *  both "Long Term Brokerage"), and `targetAccountName` alone can't tell
   *  them apart. When set, the engine matches on (name, ownerName) before
   *  falling back to name alone, mirroring how `ContributionSpec.ownerName`
   *  already disambiguates the same collision for ongoing contributions
   *  (`individual-account-tracking.ts`'s `buildSpecToAccountMapping`).
   *  Undefined ⇒ name-only match, unchanged behavior for every lump sum
   *  saved before this field existed. */
  targetOwnerName?: string;
  /** Whose money it is when no account is named: "Portfolio" for the
   *  Brokerage page's lump sums (Portfolio savings), otherwise retirement
   *  money (the retirement projection's own). Picks Portfolio- or
   *  Retirement-parented accounts first. */
  targetParentCategory?: "Retirement" | "Portfolio";
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
  /** The household's chosen account for reinvested RMD money (Retirement
   *  settings) — resolved by the payload; at most one account. */
  rmdExcessTarget?: boolean;
  /** A retirement brokerage that exists only in the projection — added when
   *  the household has no Retirement brokerage, so retirement money that
   *  needs a brokerage home (contribution overflow, reinvested RMD money)
   *  never lands in a Portfolio account. It also takes retirement lump sums
   *  with no account named, and the Brokerage page's ramp only when the
   *  household has no brokerage at all; never contributions of its own or
   *  goal draws. Spent in retirement like any retirement account. */
  projectedOnly?: boolean;
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
  /** "Now" Rule of 55 / separation resolution for this account —
   *  only present for 401k/403b-type accounts
   *  (`accountType` config's `rothOrderingRules === "pro_rata"`) with a
   *  resolvable owner. The engine re-evaluates this for a future projected
   *  year itself via `projectRuleOf55`
   *  (`src/lib/pure/accounts/tax-bucket-projection.ts`) rather than trusting a
   *  precomputed "now" answer for a different year. Not yet consumed by
   *  the engine (Group 2 wires the withdrawal-ordering eligibility gate) —
   *  purely additive data threading in this pass. */
  ruleOf55?: RuleOf55Status | null;
  /** Companion to `ruleOf55` — Roth contribution/conversion basis "now",
   *  same scope/caveats. Not yet consumed (see above). */
  rothBasisMeta?: RothBasisMeta | null;
  /** `ownerPersonId`'s birth year — carried directly on
   *  the account rather than requiring a separate personId→birthYear
   *  lookup at consumption time. No general "every household member's
   *  birth year, keyed by personId" map exists elsewhere in `EngineInput`:
   *  `perPersonBirthYears` is a positional array (no personId link), and
   *  `socialSecurityEntries`/`rmdStartAgeByPerson` are only populated for
   *  multi-person households. Attaching it here means the withdrawal-
   *  eligibility gate (Group 2) never depends on which of those partial
   *  sources happened to cover a given owner. */
  ownerBirthYear?: number;
  /** The owner's planned retirement year (birth year + retirement age) —
   *  when a still-active job is assumed to end, for Rule of 55. */
  ownerRetirementYear?: number;
  /** Rule of 55 forecasting override — per-person, forces the
   *  PROJECTED (future-year) Rule of 55 verdict to ineligible for this
   *  account's owner, regardless of what the real job-separation
   *  computation says. Only ever set `true` (never `false`) — omitted
   *  entirely for the default (no override) case, so every household not
   *  using this feature has a byte-identical engine input (and so an
   *  unchanged projection-cache hash — see `hashEngineInput` in
   *  `server/helpers/projection-cache.ts`). One-directional: can only push
   *  eligibility from true to false. See `projectRuleOf55`'s
   *  `opts.forceIneligible` docblock (`lib/pure/accounts/tax-bucket-projection.ts`)
   *  for the full contract, and why this is threaded as a parameter INTO
   *  that function rather than checked by either of its two callers —
   *  short-circuiting to "locked" in the consumer was a real bug
   *  (Rule-of-55-ineligible isn't the same as locked; the
   *  59½ path must still apply). */
  ruleOf55ForceIneligible?: boolean;
  /** Household is fine paying the 10%/20% early-withdrawal penalty on THIS
   *  account when the projection needs to draw from it. Makes this
   *  account's penalty-exposed balance normally withdrawable — NOT a
   *  strict last-resort guarantee; ordinary routing order still decides
   *  when it's drawn (see `performanceAccounts.allowPenalizedWithdrawals`'s
   *  docblock, `schema-pg.ts`, for the full contract and the tracked
   *  follow-up for true last-resort ordering). Only ever set `true` —
   *  omitted entirely for the default (no override) case, same cache-hash-
   *  stability convention as `ruleOf55ForceIneligible` above. Consumed by
   *  `computeWithdrawalEligibility` (`lib/pure/accounts/eligibility.ts`),
   *  which uses it to compute a second, narrower "still-excluded" aggregate
   *  that `subtractPenaltyExposed` (`lib/pure/engine/balance-utils.ts`)
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
  /** The projection-only retirement brokerage (IndividualAccountInput.projectedOnly);
   *  rows appear only once it holds money. */
  projectedOnly?: boolean;
  balance: number;
  /** Cost basis (brokerage-type accounts), tracked per account by the
   *  engine (brokerage-basis.ts). */
  costBasis?: number;
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
   *  (decumulation only). `true` = the
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
  /** Start-of-year dollars drawable this year without the early-withdrawal
   *  penalty, and those that aren't (before this year's withdrawals and
   *  growth — the numbers routing used; decumulation only). */
  penaltyFreeAmount?: number;
  penaltyExposedAmount?: number;
  /** The household lets this account take penalized draws. */
  allowPenalizedWithdrawals?: boolean;
  /** Tracked Roth basis remaining at END of this year, both phases
   *  (see `@/lib/pure/accounts/roth-basis-tracking`). Contribution + conversion basis
   *  combined. Present only for taxFree-bucket accounts; absent (not
   *  zero) for everything else, so "no data" is never confused with
   *  "$0 left". */
  rothBasisRemaining?: number;
  /** `rothBasisRemaining`'s two parts, as the engine tracked them. */
  rothContributionBasisRemaining?: number;
  rothConversionBasisRemaining?: number;
  /** Basis dollars THIS year's withdrawal actually consumed (retirement
   *  years and gap years) — the portion that was basis, not growth. */
  rothBasisDrawn?: number;
  /** True when `rothBasisRemaining` rests on a stale (pre-projection) or
   *  auto-seeded, never-reviewed `account_basis` row — the figure may
   *  understate real basis, never overstate it. */
  rothBasisUncertain?: boolean;
};

/** Account category — auto-derived from ACCOUNT_TYPE_CONFIG keys. Re-exported for convenience. */
export type { AccountCategory } from "@/lib/config/account-types";
export type { AccountBalance } from "@/lib/config/account-types.types";
