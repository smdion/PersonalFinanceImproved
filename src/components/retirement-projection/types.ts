/** Domain types for the projection card — tooltip data shapes, lump sum events, serialized override payloads, and account split computation inputs. */
import type { AccountCategory } from "@/lib/config/account-types";
import type { WithdrawalRoutingMode } from "@/lib/config/withdrawal-routing";
import type { LumpSumTargetIds } from "./lump-sum-target";

// ---------------------------------------------------------------------------
// Tooltip builder types
// ---------------------------------------------------------------------------

export type TipColor =
  | "green"
  | "blue"
  | "red"
  | "amber"
  | "emerald"
  | "violet"
  | "gray"
  | "teal"
  | "purple";

/** A single line item — contribution, withdrawal, balance component, etc. */
export type TooltipLineItem = {
  label: string;
  amount: number;
  prefix?: "+" | "-";
  taxType?: "roth" | "traditional";
  percent?: number;
  match?: number;
  matchLabel?: string;
  associatedMatch?: number;
  color?: TipColor;
  sub?: TooltipLineItem[];
  /** Section eyebrow key for a money tooltip's `items`: items sharing a
   *  `group` render together under one uppercase header; ungrouped items
   *  render first. */
  group?: string;
  /** Dim secondary line under this item for facts about the SAME account
   *  (eligibility verdict, Roth basis draw-down), so the name isn't repeated. */
  note?: string;
  /** Colors `note` amber with a ⚠ glyph instead of the default dim ✓. */
  noteLocked?: boolean;
};

export type TooltipData =
  | {
      kind: "money";
      header: string;
      meta?: string;
      meta2?: string;
      /** RMD status, matching the chart tooltip: `satisfiedNotably` adds a
       *  checkmark when met; `shortfallAmount > 0` earns a red IRS excise-tax
       *  line. `excessAmount` wording follows `excessMode` (rmdExcessHandling). */
      rmd?: {
        amount: number;
        isStartYear: boolean;
        satisfiedNotably: boolean;
        shortfallAmount: number;
        excessAmount: number;
        excessMode: "reinvest" | "spend";
        /** Money sent directly to charity, satisfying part of the RMD
         *  tax-free. */
        qcdAmount?: number;
        /** "Why is my RMD this amount": per-person divisor × balance text,
         *  pre-formatted by the caller from `rmdByPerson` (or the household
         *  `rmdDivisor` fallback); never re-derived here. */
        divisorDetail?: string;
      };
      /** Material spending-need shortfall for this year (engine's
       *  `unmetNeedMaterial` verdict). Set only when the engine's materiality
       *  floor is cleared; never re-derive that threshold in a component. */
      shortfall?: {
        amount: number;
        /** What penalty-locked money could cover of `amount`; overlaps
         *  `nonRetirementAmount` (each ≤ `amount`, never added). */
        penaltyAvoidedAmount?: number;
        /** What Portfolio money could cover of `amount`; overlaps
         *  `penaltyAvoidedAmount` (each ≤ `amount`, never added). */
        nonRetirementAmount?: number;
      };
      /** Guardrail/spending-strategy event for this year (e.g. Guyton-Klinger
       *  raise/cut), as marked on the Balance chart. Build via
       *  `buildStrategyEventStyle` in projection-display.ts to share the chart's wording/color. */
      strategyEvent?: { color: string; text: string };
      items?: TooltipLineItem[];
      total?: {
        label: string;
        amount: number;
        prefix?: "+" | "-";
        match?: number;
        matchLabel?: string;
        associatedMatch?: number;
      };
      taxSplit?: { traditional: number; roth: number };
      growth?: { amount: number };
      withdrawals?: { amount: number; taxCost?: number };
      contributions?: { amount: number };
      yearChange?: {
        total: number;
        change: number;
        parts?: { label: string; amount: number; color: TipColor }[];
      };
      rateCeiling?: { uncapped: number; capped: number; pct: number };
      overrideNote?: string;
      routingNote?: string;
      budget?: { profile: string; amount: number };
      proRate?: {
        months: number;
        annualAmount: number;
        proRatedAmount: number;
      };
      irsLimit?: { category: string; limit: number; used: number };
      legend?: { label: string; color: TipColor }[];
      balance?: number;
    }
  | {
      kind: "info";
      lines: {
        text: string;
        style: "header" | "meta" | "note";
        color?: TipColor;
      }[];
    };

// ---------------------------------------------------------------------------
// Lump sum events
// ---------------------------------------------------------------------------

/** Standalone lump sum entry with year — used by shared LumpSumForm and DB persistence. */
export type LumpSumEvent = {
  id: string;
  year: string;
  amount: string; // negative for withdrawals
  targetAccount: AccountCategory;
  targetAccountName: string;
  /** Owner of the targeted individual account — disambiguates two household
   *  members' identically-named accounts. "" = not set. */
  targetOwnerName: string;
  taxType: "traditional" | "roth" | "";
  label: string;
} & LumpSumTargetIds;

// ---------------------------------------------------------------------------
// Serialized override types (what we store in state / send to API)
// ---------------------------------------------------------------------------

export type AccumOverride = {
  year: number;
  personName?: string; // when set, override applies to this person only
  contributionRate?: number;
  routingMode?: "waterfall" | "percentage";
  accountOrder?: AccountCategory[];
  accountSplits?: Partial<Record<AccountCategory, number>>;
  taxSplits?: Record<string, number>;
  accountCaps?: Partial<Record<AccountCategory, number>>;
  taxTypeCaps?: Partial<Record<"traditional" | "roth", number>>;
  lumpSums?: Array<{
    id: string;
    amount: number;
    targetAccount: AccountCategory;
    targetAccountName?: string;
    targetOwnerName?: string;
    taxType?: "traditional" | "roth";
    /** See LumpSum.targetParentCategory. */
    targetParentCategory?: "Retirement" | "Portfolio";
    label?: string;
    /** See LumpSumTargetIds. */
    targetPerformanceAccountId?: number | null;
    targetOwnerPersonId?: number | null;
  }>;
  reset?: boolean;
  notes?: string;
};

export type DecumOverride = {
  year: number;
  personName?: string; // when set, override applies to this person only
  withdrawalRoutingMode?: WithdrawalRoutingMode;
  withdrawalOrder?: AccountCategory[];
  withdrawalSplits?: Partial<Record<AccountCategory, number>>;
  withdrawalTaxPreference?: Record<string, "traditional" | "roth">;
  withdrawalAccountCaps?: Partial<Record<AccountCategory, number>>;
  withdrawalTaxTypeCaps?: Partial<Record<"traditional" | "roth", number>>;
  rothConversionTarget?: number; // 0 = disable, 0.10/0.12/etc = target bracket
  lumpSums?: Array<{
    id: string;
    amount: number;
    targetAccount: AccountCategory;
    targetAccountName?: string;
    targetOwnerName?: string;
    taxType?: "traditional" | "roth";
    label?: string;
    /** See LumpSumTargetIds. */
    targetPerformanceAccountId?: number | null;
    targetOwnerPersonId?: number | null;
  }>;
  reset?: boolean;
  notes?: string;
};

// ---------------------------------------------------------------------------
// Account split types
// ---------------------------------------------------------------------------

type AccountSplit = {
  name: string;
  category: string;
  taxType: string;
  balance: number;
  contribution: number;
  growth: number;
};

export type AccountSplitsResult = {
  splits: AccountSplit[];
  splitContribution: number;
  splitGrowth: number;
};

// ---------------------------------------------------------------------------
// Misc computation input types
// ---------------------------------------------------------------------------

export type SpecFracInput = {
  baseAnnual: number;
  specTotal: number;
  specCount: number;
};
export type MatchFracInput = { matchAnnual: number; allMatchAnnual: number };
export type ColumnChangeInput = {
  deflate: (v: number, year: number) => number;
  balance: number;
  year: number;
  prev: { balance: number; year: number } | null;
  splitContribution: number;
  splitGrowth: number;
};
