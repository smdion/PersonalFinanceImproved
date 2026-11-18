/**
 * The ledger's opening state: every account part a flow can target is
 * declared before the first year, so no flow meets money with no part to
 * land on. A run with no accounts is left as it is.
 */
import {
  getAccountTypeConfig,
  getDisplayConfig,
  getAllCategories,
  getEngineCategories,
  isOverflowTarget,
  isRetirementMoney,
  buildCategoryRecord,
  isTaxFreeBucket,
  zeroBalance,
} from "../../config/account-types";
import { PORTFOLIO_TAX_TYPE_VALUES } from "../../config/enum-values";
import {
  PERF_CATEGORY_RETIREMENT,
  PROJECTED_RETIREMENT_BROKERAGE_LABEL,
} from "../../config/display-labels";
import {
  emptyTaxBucketMap,
  ROTH_SPLIT_PARTS,
  taxTypeOnSide,
} from "../../config/tax-treatment-buckets";
import { roundToCents } from "../../utils/math";
import { accountKeyOf } from "../accounts/account-part";
import type {
  AccountBalances,
  IndividualAccountInput,
  TaxBuckets,
} from "../accounts/account-balances.types";
import type { ProjectionInput } from "./types/projection-result";

/** The two tax parts of an account type that `supportsRothSplit`. */
const SPLIT_TAX_TYPES: readonly string[] = Object.values(ROTH_SPLIT_PARTS);

/** The engine input's flows that can reach a slice no part covers. */
export type OpeningFlows = Pick<
  ProjectionInput,
  "accumulationOverrides" | "decumulationOverrides"
>;

/** A slice of money: its category, tax type and parent (whose money it is). */
type Slice = Pick<
  IndividualAccountInput,
  "category" | "taxType" | "parentCategory"
>;

/**
 * The held parts; the projected Retirement brokerage when none is held; a
 * projected part for each slice a flow reaches that no part takes; then each
 * Roth-capable part's missing tax part, per owner, at $0.
 */
export function declareOpeningParts(
  held: readonly IndividualAccountInput[],
  flows: OpeningFlows,
): IndividualAccountInput[] {
  if (held.length === 0) return [];
  const parts = [...held];
  const overflowCategory = getAllCategories().find(isOverflowTarget)!;
  if (!held.some((ia) => isRetirementBrokerage(ia.category, ia.parentCategory)))
    parts.push(
      projectedPart({
        category: overflowCategory,
        taxType: getAccountTypeConfig(overflowCategory).taxBucketKey,
        parentCategory: PERF_CATEGORY_RETIREMENT,
      }),
    );
  for (const slice of lumpSumSlices(flows))
    if (!parts.some((ia) => takesSlice(ia, slice)))
      parts.push(projectedPart(slice));
  return withOtherTaxParts(parts);
}

/** Each lump sum's slice, in either phase; an unset parent is Retirement's. */
function lumpSumSlices(flows: OpeningFlows): Slice[] {
  const overrides = [
    ...flows.accumulationOverrides,
    ...flows.decumulationOverrides,
  ];
  return overrides.flatMap(({ lumpSums }) =>
    (lumpSums ?? []).map((ls) => ({
      category: ls.targetAccount,
      taxType: taxTypeOnSide(ls.targetAccount, ls.taxType),
      parentCategory: ls.targetParentCategory ?? PERF_CATEGORY_RETIREMENT,
    })),
  );
}

/** A part takes a slice's money: its category, and its tax type or (a
 *  Roth-capable account) its other tax part, which is declared beside it. */
function takesSlice(ia: IndividualAccountInput, slice: Slice): boolean {
  if (ia.category !== slice.category) return false;
  if (ia.taxType === slice.taxType) return true;
  return (
    getAccountTypeConfig(ia.category).supportsRothSplit &&
    SPLIT_TAX_TYPES.includes(ia.taxType) &&
    SPLIT_TAX_TYPES.includes(slice.taxType)
  );
}

/** The engine's own $0 part of a slice no account holds: no owner, shown once
 *  it holds money, named by its parent and category. */
function projectedPart(slice: Slice): IndividualAccountInput {
  const { category, parentCategory } = slice;
  const name = isRetirementBrokerage(category, parentCategory)
    ? PROJECTED_RETIREMENT_BROKERAGE_LABEL
    : `${parentCategory} ${getDisplayConfig(category).displayLabel} (projected)`;
  return {
    name,
    category,
    taxType: slice.taxType,
    startingBalance: 0,
    startingBasis: 0,
    parentCategory,
    origin: "projected",
  };
}

/** The parts, then each Roth-capable part's missing tax part, per owner, at
 *  $0, with the part's origin (a held part's is "declared"). */
function withOtherTaxParts(
  parts: IndividualAccountInput[],
): IndividualAccountInput[] {
  const keys = new Set(parts.map((ia) => accountKeyOf(ia)));
  for (const ia of [...parts]) {
    if (!getAccountTypeConfig(ia.category).supportsRothSplit) continue;
    if (!SPLIT_TAX_TYPES.includes(ia.taxType)) continue;
    // The account's facts; the part's money, basis and RMD target stay with it.
    const {
      startingBasis: _basis,
      rothBasisMeta: _rothBasis,
      rmdExcessTarget: _target,
      ...facts
    } = ia;
    for (const taxType of SPLIT_TAX_TYPES) {
      const part = {
        ...facts,
        taxType,
        startingBalance: 0,
        origin: ia.origin ?? ("declared" as const),
      };
      const key = accountKeyOf(part);
      if (keys.has(key)) continue;
      keys.add(key);
      parts.push(part);
    }
  }
  return parts;
}

/**
 * Parts with no real account behind them, holding the given per-category
 * balances: each category's tax parts, Retirement money with no owner.
 */
export function syntheticOpeningParts(
  byCategory: AccountBalances,
): IndividualAccountInput[] {
  return getEngineCategories().flatMap((category) => {
    const balance = byCategory[category];
    const { displayLabel, taxBucketKey } = getAccountTypeConfig(category);
    const part = (taxType: string, money: number, basis?: number) => ({
      name: displayLabel,
      category,
      taxType,
      startingBalance: money,
      ...(basis != null ? { startingBasis: basis } : {}),
      parentCategory: PERF_CATEGORY_RETIREMENT,
      origin: "synthetic" as const,
    });
    if (balance.structure === "roth_traditional")
      return SPLIT_TAX_TYPES.map((taxType) =>
        part(
          taxType,
          isTaxFreeBucket(taxType) ? balance.roth : balance.traditional,
        ),
      );
    if (balance.structure === "single_bucket")
      return [part(taxBucketKey, balance.balance)];
    return [part(taxBucketKey, balance.balance, balance.basis)];
  });
}

/** The run's opening parts: the held accounts, or with none (nothing entered
 *  yet) synthetic parts holding the per-category money. */
export function openingParts(
  held: IndividualAccountInput[],
  byCategory: AccountBalances,
): IndividualAccountInput[] {
  return held.length > 0 ? held : syntheticOpeningParts(byCategory);
}

/** The tax buckets and per-category balances the parts hold, by the payload's
 *  rules: a part's tax type picks its bucket (none: throws); a Roth-capable
 *  category books Roth parts as Roth, others Traditional; basis is the parts'. */
export function openingTotals(parts: readonly IndividualAccountInput[]): {
  balances: TaxBuckets;
  accountBalance: AccountBalances;
} {
  const accountBalance = buildCategoryRecord(zeroBalance);
  const balances: TaxBuckets = { ...emptyTaxBucketMap(), afterTaxBasis: 0 };
  for (const ia of parts) {
    const money = ia.startingBalance;
    const balance = accountBalance[ia.category];
    const bucket = PORTFOLIO_TAX_TYPE_VALUES.find((t) => t === ia.taxType);
    if (!bucket)
      throw new Error(
        `openingTotals: part "${ia.name}" (${ia.category}) has tax type "${ia.taxType}", not a tax bucket`,
      );
    balances[bucket] += money;
    if (balance.structure !== "roth_traditional") balance.balance += money;
    else if (isTaxFreeBucket(ia.taxType)) balance.roth += money;
    else balance.traditional += money;
    if (balance.structure !== "basis_tracking" || ia.startingBasis == null)
      continue;
    balances.afterTaxBasis += ia.startingBasis;
    if (ia.startingBasis > 0) balance.basis += ia.startingBasis;
  }
  for (const balance of Object.values(accountBalance))
    for (const [k, v] of Object.entries(balance))
      if (typeof v === "number") Reflect.set(balance, k, roundToCents(v));
  for (const [k, v] of Object.entries(balances))
    Reflect.set(balances, k, roundToCents(v));
  return { balances, accountBalance };
}

/** A Retirement brokerage: where overflow and reinvested RMD money land. */
export function isRetirementBrokerage(
  category: string,
  parentCategory: string | undefined,
): boolean {
  return (
    getAllCategories().some((c) => c === category && isOverflowTarget(c)) &&
    isRetirementMoney(parentCategory)
  );
}
