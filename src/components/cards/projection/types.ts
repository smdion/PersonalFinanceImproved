/** Domain types for the projection card — tooltip data shapes, accumulation/decumulation override form types, serialized override payloads, and account split computation inputs. */
import type { AccountCategory } from "@/lib/calculators/types";
import {
  getDefaultAccumulationOrder,
  getDefaultDecumulationOrder,
  buildCategoryRecord,
  categoriesWithTaxPreference,
  getLimitGroup,
} from "@/lib/config/account-types";

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
  | "gray";

/** A single line item — contribution, withdrawal, balance component, etc. */
export type TooltipLineItem = {
  label: string;
  amount: number;
  prefix?: "+" | "-";
  taxType?: "roth" | "traditional";
  pct?: number;
  match?: number;
  matchLabel?: string;
  associatedMatch?: number;
  color?: TipColor;
  sub?: TooltipLineItem[];
};

export type TooltipData =
  | {
      kind: "money";
      header: string;
      meta?: string;
      meta2?: string;
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
// Accumulation override form types
// ---------------------------------------------------------------------------

export type LumpSumFormEntry = {
  id: string;
  amount: string;
  targetAccount: AccountCategory;
  taxType: "traditional" | "roth" | "";
  label: string;
};

export type AccumOverrideForm = {
  year: string;
  personName: string; // '' = household-wide
  contributionRate: string;
  routingMode: "waterfall" | "percentage" | "";
  accountOrder: AccountCategory[];
  accountSplits: Record<AccountCategory, string>;
  taxSplits: Record<string, string>;
  accountCaps: Record<AccountCategory, string>;
  taxTypeCaps: { traditional: string; roth: string };
  lumpSums: LumpSumFormEntry[];
  reset: boolean;
  notes: string;
};

export const emptyAccumForm: AccumOverrideForm = {
  year: String(new Date().getFullYear() + 1),
  personName: "",
  contributionRate: "",
  routingMode: "",
  accountOrder: getDefaultAccumulationOrder(),
  accountSplits: buildCategoryRecord(() => "") as Record<
    AccountCategory,
    string
  >,
  taxSplits: Object.fromEntries(
    categoriesWithTaxPreference().map((cat) => [getLimitGroup(cat) ?? cat, ""]),
  ),
  accountCaps: buildCategoryRecord(() => "") as Record<AccountCategory, string>,
  taxTypeCaps: { traditional: "", roth: "" },
  lumpSums: [],
  reset: false,
  notes: "",
};

// ---------------------------------------------------------------------------
// Decumulation override form types
// ---------------------------------------------------------------------------

export type DecumOverrideForm = {
  year: string;
  personName: string; // '' = household-wide
  withdrawalRate: string;
  withdrawalRoutingMode: "waterfall" | "percentage" | "";
  withdrawalOrder: AccountCategory[];
  withdrawalSplits: Record<AccountCategory, string>;
  withdrawalTaxPreference: Record<AccountCategory, "traditional" | "roth" | "">;
  withdrawalAccountCaps: Record<AccountCategory, string>;
  withdrawalTaxTypeCaps: { traditional: string; roth: string };
  rothConversionTarget: string; // '' = no change, '0' = disable, '0.10'/'0.12'/etc = target bracket
  lumpSums: LumpSumFormEntry[];
  reset: boolean;
  notes: string;
};

export const emptyDecumForm: DecumOverrideForm = {
  year: String(new Date().getFullYear() + 1),
  personName: "",
  withdrawalRate: "",
  withdrawalRoutingMode: "",
  withdrawalOrder: getDefaultDecumulationOrder(),
  withdrawalSplits: buildCategoryRecord(() => "") as Record<
    AccountCategory,
    string
  >,
  withdrawalTaxPreference: buildCategoryRecord(
    () => "" as "traditional" | "roth" | "",
  ) as Record<AccountCategory, "traditional" | "roth" | "">,
  withdrawalAccountCaps: buildCategoryRecord(() => "") as Record<
    AccountCategory,
    string
  >,
  withdrawalTaxTypeCaps: { traditional: "", roth: "" },
  rothConversionTarget: "",
  lumpSums: [],
  reset: false,
  notes: "",
};

// ---------------------------------------------------------------------------
// Serialized override types (what we store in state / send to API)
// ---------------------------------------------------------------------------

export type AccumOverride = {
  year: number;
  personName?: string; // when set, override applies to this person only
  contributionRate?: number;
  routingMode?: "waterfall" | "percentage";
  accountOrder?: AccountCategory[];
  accountSplits?: Record<AccountCategory, number>;
  taxSplits?: Record<string, number>;
  accountCaps?: Record<AccountCategory, number>;
  taxTypeCaps?: Partial<Record<"traditional" | "roth", number>>;
  lumpSums?: Array<{
    id: string;
    amount: number;
    targetAccount: AccountCategory;
    taxType?: "traditional" | "roth";
    label?: string;
  }>;
  reset?: boolean;
  notes?: string;
};

export type DecumOverride = {
  year: number;
  personName?: string; // when set, override applies to this person only
  withdrawalRate?: number;
  withdrawalRoutingMode?: "waterfall" | "percentage";
  withdrawalOrder?: AccountCategory[];
  withdrawalSplits?: Record<AccountCategory, number>;
  withdrawalTaxPreference?: Record<string, "traditional" | "roth">;
  withdrawalAccountCaps?: Record<AccountCategory, number>;
  withdrawalTaxTypeCaps?: Partial<Record<"traditional" | "roth", number>>;
  rothConversionTarget?: number; // 0 = disable, 0.10/0.12/etc = target bracket
  lumpSums?: Array<{
    id: string;
    amount: number;
    targetAccount: AccountCategory;
    taxType?: "traditional" | "roth";
    label?: string;
  }>;
  reset?: boolean;
  notes?: string;
};

// ---------------------------------------------------------------------------
// Override → Form converters (for edit mode)
// ---------------------------------------------------------------------------

export function accumOverrideToForm(o: AccumOverride): AccumOverrideForm {
  return {
    year: String(o.year),
    personName: o.personName ?? "",
    contributionRate:
      o.contributionRate != null ? String(o.contributionRate * 100) : "",
    routingMode: o.routingMode ?? "",
    accountOrder: o.accountOrder ?? getDefaultAccumulationOrder(),
    accountSplits: (o.accountSplits
      ? Object.fromEntries(
          Object.entries(o.accountSplits).map(([k, v]) => [
            k,
            v > 0 ? String(v * 100) : "",
          ]),
        )
      : buildCategoryRecord(() => "")) as Record<AccountCategory, string>,
    taxSplits: o.taxSplits
      ? Object.fromEntries(
          Object.entries(o.taxSplits).map(([k, v]) => [
            k,
            v > 0 ? String(v * 100) : "",
          ]),
        )
      : Object.fromEntries(
          categoriesWithTaxPreference().map((cat) => [
            getLimitGroup(cat) ?? cat,
            "",
          ]),
        ),
    accountCaps: (o.accountCaps
      ? Object.fromEntries(
          Object.entries(o.accountCaps).map(([k, v]) => [
            k,
            v > 0 ? String(v) : "",
          ]),
        )
      : buildCategoryRecord(() => "")) as Record<AccountCategory, string>,
    taxTypeCaps: {
      traditional:
        o.taxTypeCaps?.traditional != null
          ? String(o.taxTypeCaps.traditional)
          : "",
      roth: o.taxTypeCaps?.roth != null ? String(o.taxTypeCaps.roth) : "",
    },
    lumpSums: (o.lumpSums ?? []).map((ls) => ({
      id: ls.id,
      amount: String(ls.amount),
      targetAccount: ls.targetAccount,
      taxType: ls.taxType ?? "",
      label: ls.label ?? "",
    })),
    reset: o.reset ?? false,
    notes: o.notes ?? "",
  };
}

export function decumOverrideToForm(o: DecumOverride): DecumOverrideForm {
  return {
    year: String(o.year),
    personName: o.personName ?? "",
    withdrawalRate:
      o.withdrawalRate != null ? String(o.withdrawalRate * 100) : "",
    withdrawalRoutingMode: o.withdrawalRoutingMode ?? "",
    withdrawalOrder: o.withdrawalOrder ?? getDefaultDecumulationOrder(),
    withdrawalSplits: (o.withdrawalSplits
      ? Object.fromEntries(
          Object.entries(o.withdrawalSplits).map(([k, v]) => [
            k,
            v > 0 ? String(v * 100) : "",
          ]),
        )
      : buildCategoryRecord(() => "")) as Record<AccountCategory, string>,
    withdrawalTaxPreference: (o.withdrawalTaxPreference
      ? Object.fromEntries(
          Object.entries(o.withdrawalTaxPreference).map(([k, v]) => [k, v]),
        )
      : Object.fromEntries(
          categoriesWithTaxPreference().map((cat) => [cat, "" as const]),
        )) as Record<AccountCategory, "traditional" | "roth" | "">,
    withdrawalAccountCaps: (o.withdrawalAccountCaps
      ? Object.fromEntries(
          Object.entries(o.withdrawalAccountCaps).map(([k, v]) => [
            k,
            v > 0 ? String(v) : "",
          ]),
        )
      : buildCategoryRecord(() => "")) as Record<AccountCategory, string>,
    withdrawalTaxTypeCaps: {
      traditional:
        o.withdrawalTaxTypeCaps?.traditional != null
          ? String(o.withdrawalTaxTypeCaps.traditional)
          : "",
      roth:
        o.withdrawalTaxTypeCaps?.roth != null
          ? String(o.withdrawalTaxTypeCaps.roth)
          : "",
    },
    rothConversionTarget:
      o.rothConversionTarget != null ? String(o.rothConversionTarget) : "",
    lumpSums: (o.lumpSums ?? []).map((ls) => ({
      id: ls.id,
      amount: String(ls.amount),
      targetAccount: ls.targetAccount,
      taxType: ls.taxType ?? "",
      label: ls.label ?? "",
    })),
    reset: o.reset ?? false,
    notes: o.notes ?? "",
  };
}

// ---------------------------------------------------------------------------
// Account split types
// ---------------------------------------------------------------------------

export type AccountSplit = {
  name: string;
  category: string;
  taxType: string;
  balance: number;
  contribution: number;
  growth: number;
};

export type AccountSplitsResult = {
  splits: AccountSplit[];
  splitContrib: number;
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
  deflate: (v: number, yr: number) => number;
  bal: number;
  year: number;
  prev: { bal: number; year: number } | null;
  splitContrib: number;
  splitGrowth: number;
};
