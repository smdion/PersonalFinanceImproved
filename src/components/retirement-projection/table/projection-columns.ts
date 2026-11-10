/** The projection table's account columns: a column key's category and Roth/Traditional side, its balance, withdrawal and inflow, and the per-column change, split and contribution-fraction arithmetic. */
import type { AccumulationSlot } from "@/lib/pure/engine/types";
import {
  type AccountCategory,
  parseColumnKey,
  ACCOUNT_TYPE_CONFIG,
  isRothType,
  isTaxFree,
  isTaxFreeBucket,
} from "@/lib/config/account-types";
import {
  getTraditionalBalance,
  getRothBalance,
  getTotalBalance,
} from "@/lib/pure/accounts/account-balance";
import { safeDivide } from "@/lib/utils/math";
import type { IndividualAccountYearBalance } from "@/lib/pure/accounts/account-balances.types";
import type {
  AccountSplitsResult,
  SpecFracInput,
  MatchFracInput,
  ColumnChangeInput,
} from "../types";

export function itemTaxType(
  category: string,
  taxField?: string,
): "roth" | "traditional" | undefined {
  const cfg =
    category in ACCOUNT_TYPE_CONFIG
      ? ACCOUNT_TYPE_CONFIG[category as AccountCategory]
      : null;
  if (!cfg || !cfg.supportsRothSplit) return undefined;
  const t = taxField ?? "";
  if (isRothType(t) || isTaxFree(t) || isTaxFreeBucket(t)) return "roth";
  return "traditional";
}

type ColumnTreatment = "traditional" | "roth" | null; // a Roth-split column's side
const isRothColumn = (t: ColumnTreatment) => t === "roth";

const isTraditionalColumn = (t: ColumnTreatment) => t === "traditional";

/** Derive category + tax treatment from a column key like '401k_trad', 'hsa', 'brokerage'. */
export function colKeyParts(key: string): {
  category: string;
  treatment: ColumnTreatment;
} {
  const parsed = parseColumnKey(key);
  if (!parsed) return { category: key, treatment: null };
  const treatment =
    parsed.subKey === "trad"
      ? ("traditional" as const)
      : parsed.subKey === "roth"
        ? ("roth" as const)
        : null;
  return { category: parsed.category, treatment };
}

/** Read a column's balance from balanceByAccount — data-driven, no if-chains. */
export function colBalance(
  ba: import("@/lib/pure/accounts/account-balances.types").AccountBalances,
  key: string,
): number {
  const { category, treatment } = colKeyParts(key);
  const balance = ba[category as AccountCategory];
  if (!balance) return 0;
  if (isRothColumn(treatment)) return getRothBalance(balance);
  if (isTraditionalColumn(treatment)) return getTraditionalBalance(balance);
  return getTotalBalance(balance);
}

/** Sum withdrawals for a column key across all slots — data-driven, no if-chains. */
export function colWithdrawal(
  slots: {
    category: string;
    withdrawal: number;
    rothWithdrawal: number;
    traditionalWithdrawal: number;
  }[],
  key: string,
): number {
  const { category, treatment } = colKeyParts(key);
  let total = 0;
  for (const slot of slots) {
    if (slot.category !== category) continue;
    if (isRothColumn(treatment)) total += slot.rothWithdrawal;
    else if (isTraditionalColumn(treatment))
      total += slot.traditionalWithdrawal;
    else total += slot.withdrawal;
  }
  return total;
}

/** Map a column key (e.g. '401k_roth', 'hsa') to the engine's taxType string for IA filtering. */
export function colEngineTaxType(key: string): string | null {
  const { treatment } = colKeyParts(key);
  if (isRothColumn(treatment)) return "taxFree";
  if (isTraditionalColumn(treatment)) return "preTax";
  const parsed = parseColumnKey(key);
  if (parsed) {
    const cfg = ACCOUNT_TYPE_CONFIG[parsed.category];
    return cfg.taxBucketKey;
  }
  return null;
}

/** Total balance inflow (employee + match) for a specific account column — mirrors engine balance routing. */
export function slotsColumnBalanceInflow(
  slots: AccumulationSlot[],
  colKey: string,
): number {
  const { category, treatment } = colKeyParts(colKey);
  const slot = slots.find((s) => s.category === category);
  if (!slot) return 0;
  if (isTraditionalColumn(treatment))
    return slot.traditionalContrib + slot.employerMatch;
  if (isRothColumn(treatment)) return slot.rothContrib; // roth match flows to preTax, not here
  return slot.employeeContrib + slot.employerMatch;
}

export function percentOf(value: number, total: number): number {
  return Math.round(safeDivide(value, total) * 100);
}

export function proRateMonths(fraction: number): number {
  return Math.round(fraction * 12);
}

export function specFrac({
  baseAnnual,
  specTotal,
  specCount,
}: SpecFracInput): number {
  return specTotal > 0 ? baseAnnual / specTotal : safeDivide(1, specCount, 1);
}

export function matchFracOf({
  matchAnnual,
  allMatchAnnual,
}: MatchFracInput): number {
  return safeDivide(matchAnnual, allMatchAnnual);
}

export function computeColumnChange({
  deflate,
  balance,
  year,
  prev,
  splitContribution,
  splitGrowth,
}: ColumnChangeInput) {
  const deflatedBalance = deflate(balance, year);
  const deflatedPrev = prev ? deflate(prev.balance, prev.year) : 0;
  const displayContribution = deflate(splitContribution, year);
  const displayGrowth = deflate(splitGrowth, year);
  const displayChange = prev
    ? deflatedBalance - deflatedPrev
    : displayContribution + displayGrowth;
  return {
    displayChange,
    displayContribution,
    displayGrowth,
    boyBalance: prev
      ? deflatedPrev
      : deflate(balance - splitContribution - splitGrowth, year),
  };
}

/** Compute per-account contribution/growth splits from engine's tracked fields (not balance-change derivation). */
export function computeAccountSplits(
  accounts: IndividualAccountYearBalance[],
): AccountSplitsResult {
  const seen = new Set<string>();
  const splits: {
    name: string;
    category: string;
    taxType: string;
    balance: number;
    contribution: number;
    growth: number;
  }[] = [];
  let splitContribution = 0;
  let splitGrowth = 0;
  for (const ia of accounts) {
    const key = `${ia.category}::${ia.name}::${ia.taxType}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const contribution = Math.max(0, ia.contribution + ia.employerMatch);
    if (ia.balance > 0 || contribution > 1 || Math.abs(ia.growth) > 1) {
      splits.push({
        name: ia.name,
        category: ia.category,
        taxType: ia.taxType,
        balance: ia.balance,
        contribution: contribution,
        growth: ia.growth,
      });
      splitContribution += contribution;
      splitGrowth += ia.growth;
    }
  }
  return { splits, splitContribution, splitGrowth };
}
