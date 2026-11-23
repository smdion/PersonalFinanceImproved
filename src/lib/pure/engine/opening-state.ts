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
import { accountIdKeyOf, hasRealAccount } from "../accounts/account-part";
import { specParts } from "./individual-accounts/spec-accounts";
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
  | "accumulationDefaults"
  | "accumulationOverrides"
  | "decumulationOverrides"
  | "contributionSpecs"
  | "baseYearContributions"
  | "profileSwitches"
  | "employerMatchRateByCategory"
  | "baseYearEmployerMatch"
  | "employerMatchByParentCat"
>;

/** A slice of money: its category, tax type and parent (whose money it is). */
type Slice = Pick<
  IndividualAccountInput,
  "category" | "taxType" | "parentCategory"
>;

/** The held parts and each spec's own part (none real: left as given); the
 *  projected Retirement brokerage when none is held, a projected part for each
 *  slice no part takes; then each Roth-capable part's other tax parts at $0. */
export function declareOpeningParts(
  held: readonly IndividualAccountInput[],
  flows: OpeningFlows,
): IndividualAccountInput[] {
  const parts = withSpecParts(
    held.filter((ia) => ia.origin !== "synthetic"),
    flows,
  );
  if (!parts.some(hasRealAccount)) return [...held];
  refuseMixedRun(held, flows);
  const overflowCategory = getAllCategories().find(isOverflowTarget)!;
  if (
    !parts.some((ia) => isRetirementBrokerage(ia.category, ia.parentCategory))
  )
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
  for (const slice of noSpecSlices(flows))
    if (
      !parts.some(
        (ia) => takesSlice(ia, slice) && isRetirementMoney(ia.parentCategory),
      )
    )
      parts.push(projectedPart(slice));
  for (const { slice, anyParent } of matchSlices(flows))
    if (
      !parts.some(
        (ia) =>
          takesSlice(ia, slice) &&
          (anyParent || ia.parentCategory === slice.parentCategory),
      )
    )
      parts.push(projectedPart(slice));
  return refuseSharedKeys(withOtherTaxParts(parts));
}

/** Every stretch's contribution specs: the opening profile's, each switch's. */
const stretchSpecs = (flows: OpeningFlows) => [
  ...(flows.contributionSpecs ?? []),
  ...(flows.profileSwitches ?? []).flatMap((s) => s.contributionSpecs),
];

/** The parts, then each spec's own part where its account has none of its
 *  key (`specParts`; the siblings the last step declares count). Simple's
 *  specs pay the synthetic pot, which has no real account. */
function withSpecParts(
  parts: IndividualAccountInput[],
  flows: OpeningFlows,
): IndividualAccountInput[] {
  for (const spec of stretchSpecs(flows)) {
    if (spec.account.kind === "synthetic") continue;
    const known = withOtherTaxParts([...parts]);
    for (const part of specParts(spec, known))
      if (!known.includes(part)) parts.push(part);
  }
  return parts;
}

/** A run with real accounts holds no synthetic money and no spec paying the
 *  synthetic pot: either would sit beside the real accounts. */
function refuseMixedRun(
  held: readonly IndividualAccountInput[],
  flows: OpeningFlows,
): void {
  const money = held.find(
    (ia) =>
      ia.origin === "synthetic" &&
      (ia.startingBalance !== 0 || Boolean(ia.startingBasis)),
  );
  if (money) throw new Error("A synthetic part holds money beside accounts");
  if (stretchSpecs(flows).some((s) => s.account.kind === "synthetic"))
    throw new Error("A spec pays the synthetic pot beside real accounts");
}

/** Each part its own key: two parts with one key would share one balance in
 *  the ledger, the second overwriting the first. */
function refuseSharedKeys(
  parts: IndividualAccountInput[],
): IndividualAccountInput[] {
  const keys = new Set<string>();
  for (const ia of parts) {
    const key = accountIdKeyOf(ia);
    if (keys.has(key))
      throw new Error(
        `Two account parts have one key (${key}): "${ia.name}" and another`,
      );
    keys.add(key);
  }
  return parts;
}

/** A stated amount above $0 (an absent one is none). */
const positive = (v: number | undefined) => v != null && v > 0;

/**
 * Where a stretch with no contribution specs saves: each category
 * routing or year 0's amounts can fill, as Retirement money, when the opening
 * profile or a profile switch saves with no specs.
 */
function noSpecSlices(flows: OpeningFlows): Slice[] {
  const opening = {
    contributionSpecs: flows.contributionSpecs ?? [],
    contributionRate: flows.accumulationDefaults.contributionRate,
    baseYearContributions: flows.baseYearContributions,
  };
  const stretches = [opening, ...(flows.profileSwitches ?? [])];
  const routings = [flows.accumulationDefaults, ...flows.accumulationOverrides];
  const rated = flows.accumulationOverrides.some((o) =>
    positive(o.contributionRate),
  );
  const categories = getAllCategories().filter(
    (c) =>
      isOverflowTarget(c) ||
      routings.some(
        (r) => r.accountOrder?.includes(c) || positive(r.accountSplits?.[c]),
      ) ||
      stretches.some((s) => positive(s.baseYearContributions?.[c])),
  );
  const saves = stretches.some(
    (s) =>
      s.contributionSpecs.length === 0 &&
      (rated ||
        s.contributionRate > 0 ||
        Object.values(s.baseYearContributions ?? {}).some((v) => v > 0)),
  );
  if (!saves) return [];
  return categories.map((category) => ({
    category,
    taxType: taxTypeOnSide(category, "traditional"),
    parentCategory: PERF_CATEGORY_RETIREMENT,
  }));
}

/** A match's slice; with no parent named, a part of any parent takes it. */
type MatchSlice = { slice: Slice; anyParent: boolean };

/**
 * Where an employer match lands, in any stretch, specs or not: its category's
 * Traditional side per parent it names; naming none, any part of its category.
 */
function matchSlices(flows: OpeningFlows): MatchSlice[] {
  const stretches = [flows, ...(flows.profileSwitches ?? [])];
  return stretches.flatMap((s) =>
    getAllCategories()
      .filter(
        (c) =>
          s.employerMatchRateByCategory[c] > 0 ||
          positive(s.baseYearEmployerMatch?.[c]),
      )
      .flatMap((category): MatchSlice[] => {
        const parents = [
          ...(s.employerMatchByParentCat?.get(category) ?? []),
        ].filter(([, amount]) => amount > 0);
        const slice = (parentCategory: string) => ({
          category,
          taxType: taxTypeOnSide(category, "traditional"),
          parentCategory,
        });
        return parents.length > 0
          ? parents.map(([parent]) => ({
              slice: slice(parent),
              anyParent: false,
            }))
          : [{ slice: slice(PERF_CATEGORY_RETIREMENT), anyParent: true }];
      }),
  );
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
  const keys = new Set(parts.map((ia) => accountIdKeyOf(ia)));
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
      const key = accountIdKeyOf(part);
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
