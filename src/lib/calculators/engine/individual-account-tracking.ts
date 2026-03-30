/**
 * Individual Account Tracking — per-account bookkeeping across the projection.
 *
 * Routes contributions, employer match, overflow, ramp, and withdrawals
 * to individual accounts within each category. Maintains running balances
 * via the `indBal` map (composite key → balance).
 *
 * This is an "aspect" module — it doesn't own pipeline state but provides
 * helpers that the orchestrator calls at each relevant pipeline stage.
 */
import type {
  ContributionSpec,
  AccumulationSlot,
  DecumulationSlot,
  AccountCategory,
  IndividualAccountYearBalance,
  IndividualAccountInput,
} from "../types";
import { roundToCents } from "../../utils/math";
import {
  getAccountTypeConfig,
  isOverflowTarget,
  getAllCategories,
} from "../../config/account-types";
import { TAX_TREATMENT_TO_TAX_TYPE } from "../../config/display-labels";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Composite key function for individual accounts. */
export type IndKeyFn = (ia: {
  name: string;
  category: string;
  taxType: string;
}) => string;

/** Creates the standard composite key function. */
export function makeIndKey(): IndKeyFn {
  return (ia) => `${ia.name}::${ia.category}::${ia.taxType}`;
}

/** Creates spec key from contribution spec fields. */
export function specKeyOf(spec: {
  name: string;
  personId?: number | null;
  taxTreatment: string;
}): string {
  return spec.personId != null
    ? `${spec.name}::${spec.personId}::${spec.taxTreatment}`
    : `${spec.name}::${spec.taxTreatment}`;
}

// ---------------------------------------------------------------------------
// Spec → Account Matching
// ---------------------------------------------------------------------------

/**
 * Build mapping from contribution spec keys to individual account keys.
 * Match on structured fields: category + ownerName + taxType (no fuzzy logic).
 */
export function buildSpecToAccountMapping(
  contributionSpecs: ContributionSpec[],
  indAccts: IndividualAccountInput[],
  indKey: IndKeyFn,
  indParentCat: Map<string, string>,
): { specToAccount: Map<string, string>; accountsWithSpecs: Set<string> } {
  const taxTreatmentToTaxType = TAX_TREATMENT_TO_TAX_TYPE;
  const specToAccount = new Map<string, string>();

  for (const spec of contributionSpecs) {
    const specTaxType =
      taxTreatmentToTaxType[spec.taxTreatment] ?? spec.taxTreatment;
    const parentCatMatch = (ia: {
      name: string;
      category: string;
      taxType: string;
    }) => {
      const iaPCat = indParentCat.get(indKey(ia));
      if (iaPCat && spec.parentCategory) return iaPCat === spec.parentCategory;
      return true;
    };
    const exactOwner = (ia: { ownerPersonId?: number; ownerName?: string }) =>
      ia.ownerPersonId != null && spec.personId != null
        ? ia.ownerPersonId === spec.personId
        : ia.ownerName === spec.ownerName;
    const ownerMatch = (ia: { ownerPersonId?: number; ownerName?: string }) =>
      exactOwner(ia) ||
      (ia.ownerPersonId === undefined && ia.ownerName === undefined);

    const match =
      indAccts.find(
        (ia) =>
          ia.category === spec.category &&
          exactOwner(ia) &&
          ia.taxType === specTaxType &&
          parentCatMatch(ia),
      ) ??
      indAccts.find(
        (ia) =>
          ia.category === spec.category &&
          ia.ownerPersonId === undefined &&
          ia.ownerName === undefined &&
          ia.taxType === specTaxType &&
          parentCatMatch(ia),
      ) ??
      indAccts.find(
        (ia) =>
          ia.category === spec.category && exactOwner(ia) && parentCatMatch(ia),
      ) ??
      indAccts.find(
        (ia) =>
          ia.category === spec.category &&
          ia.ownerPersonId === undefined &&
          ia.ownerName === undefined &&
          parentCatMatch(ia),
      ) ??
      indAccts.find((ia) => ia.category === spec.category && ownerMatch(ia));
    if (match) specToAccount.set(specKeyOf(spec), indKey(match));
  }

  return { specToAccount, accountsWithSpecs: new Set(specToAccount.values()) };
}

// ---------------------------------------------------------------------------
// Accumulation: Distribute Contributions to Individual Accounts
// ---------------------------------------------------------------------------

export interface DistributeContributionsInput {
  slots: AccumulationSlot[];
  contributionSpecs: ContributionSpec[];
  indAccts: IndividualAccountInput[];
  indKey: IndKeyFn;
  indBal: Map<string, number>;
  indParentCat: Map<string, string>;
  specToAccount: Map<string, string>;
  accountsWithSpecs: Set<string>;
  projectedSalary: number;
  currentSalary: number;
  limitGrowthRate: number;
  yearIndex: number;
  proRate: number;
  overflowToBrokerage: number;
  rampAmount: number;
  employerMatchByParentCat?: Map<AccountCategory, Map<string, number>>;
}

export interface DistributeContributionsResult {
  indContribs: Map<string, number>;
  indMatch: Map<string, number>;
  indIntentional: Map<string, number>;
  indOverflow: Map<string, number>;
  indRamp: Map<string, number>;
}

/**
 * Distribute slot-level contributions to individual accounts using spec weights.
 * Also handles employer match, overflow, intentional tracking, and ramp distribution.
 *
 * Mutates `indBal` in place.
 */
export function distributeContributions(
  input: DistributeContributionsInput,
): DistributeContributionsResult {
  const {
    slots,
    contributionSpecs,
    indAccts,
    indKey,
    indBal,
    indParentCat,
    specToAccount,
    accountsWithSpecs,
    projectedSalary,
    currentSalary,
    limitGrowthRate,
    yearIndex: y,
    proRate,
    overflowToBrokerage,
    rampAmount,
    employerMatchByParentCat,
  } = input;

  const indContribs = new Map<string, number>();
  const indMatch = new Map<string, number>();
  const indIntentional = new Map<string, number>();
  const indOverflow = new Map<string, number>();
  const indRamp = new Map<string, number>();

  const ACCOUNT_CATEGORIES: AccountCategory[] = getAllCategories();

  // --- Step 1: Compute raw projected amount per spec (for weighting only) ---
  const lgf = Math.pow(1 + limitGrowthRate, y);
  const specRaw = new Map<string, number>();
  const specAcct = new Map<string, string>();
  for (const spec of contributionSpecs) {
    const sk = specKeyOf(spec);
    const acctName = specToAccount.get(sk);
    if (!acctName) continue;
    let projected: number;
    if (spec.method === "percent_of_salary") {
      projected = roundToCents(
        projectedSalary * spec.salaryFraction * spec.value * proRate,
      );
    } else if (
      getAccountTypeConfig(spec.category).fixedContribScalesWithSalary
    ) {
      const salaryGrowthFactor =
        currentSalary > 0 ? projectedSalary / currentSalary : 1;
      projected = roundToCents(spec.baseAnnual * salaryGrowthFactor * proRate);
    } else {
      projected = roundToCents(spec.baseAnnual * lgf * proRate);
    }
    specRaw.set(sk, projected);
    specAcct.set(sk, acctName);
  }

  // --- Step 2: Distribute slot totals to individual accounts using spec weights ---
  for (const slot of slots) {
    const bs = getAccountTypeConfig(slot.category).balanceStructure;
    const catSpecs = contributionSpecs.filter(
      (s) => s.category === slot.category,
    );
    if (bs === "roth_traditional") {
      for (const [taxTreatment, slotAmount] of [
        ["pre_tax", slot.traditionalContrib],
        ["tax_free", slot.rothContrib],
      ] as const) {
        const typeSpecs = catSpecs.filter(
          (s) => s.taxTreatment === taxTreatment,
        );
        const rawTotal = typeSpecs.reduce(
          (s, sp) => s + (specRaw.get(specKeyOf(sp)) ?? 0),
          0,
        );
        for (const sp of typeSpecs) {
          const sk = specKeyOf(sp);
          const acctName = specAcct.get(sk);
          if (!acctName) continue;
          const weight =
            rawTotal > 0
              ? (specRaw.get(sk) ?? 0) / rawTotal
              : 1 / typeSpecs.length;
          const portion = roundToCents(slotAmount * weight);
          indContribs.set(acctName, (indContribs.get(acctName) ?? 0) + portion);
          indBal.set(acctName, (indBal.get(acctName) ?? 0) + portion);
        }
      }
    } else {
      const rawTotal = catSpecs.reduce(
        (s, sp) => s + (specRaw.get(specKeyOf(sp)) ?? 0),
        0,
      );
      for (const sp of catSpecs) {
        const sk = specKeyOf(sp);
        const acctName = specAcct.get(sk);
        if (!acctName) continue;
        const weight =
          rawTotal > 0
            ? (specRaw.get(sk) ?? 0) / rawTotal
            : 1 / catSpecs.length;
        const portion = roundToCents(slot.employeeContrib * weight);
        indContribs.set(acctName, (indContribs.get(acctName) ?? 0) + portion);
        indBal.set(acctName, (indBal.get(acctName) ?? 0) + portion);
      }
    }
  }

  // --- Step 3: Route employer match to individual accounts ---
  for (const cat of ACCOUNT_CATEGORIES) {
    const catMatch = slots.find((s) => s.category === cat)?.employerMatch ?? 0;
    if (catMatch <= 0) continue;
    const parentCatMatchData = employerMatchByParentCat?.get(cat);
    if (parentCatMatchData && parentCatMatchData.size > 0) {
      let totalMatch = 0;
      parentCatMatchData.forEach((v) => {
        totalMatch += v;
      });
      parentCatMatchData.forEach((baseMatch, pCat) => {
        const scaledMatch = roundToCents(catMatch * (baseMatch / totalMatch));
        const allPCatAccts = indAccts.filter(
          (ia) => ia.category === cat && indParentCat.get(indKey(ia)) === pCat,
        );
        if (allPCatAccts.length === 0) return;
        const preTaxPCatAccts = allPCatAccts.filter(
          (ia) => ia.taxType === "preTax",
        );
        const matchCandidates =
          preTaxPCatAccts.length > 0 ? preTaxPCatAccts : allPCatAccts;
        const pCatWithSpecs = matchCandidates.filter((ia) =>
          accountsWithSpecs.has(indKey(ia)),
        );
        const pCatAccts =
          pCatWithSpecs.length > 0 ? pCatWithSpecs : matchCandidates;
        const pCatTotal = pCatAccts.reduce(
          (s, ia) => s + (indBal.get(indKey(ia)) ?? 0),
          0,
        );
        for (const ia of pCatAccts) {
          const k = indKey(ia);
          const weight =
            pCatTotal > 0
              ? (indBal.get(k) ?? 0) / pCatTotal
              : 1 / pCatAccts.length;
          const matchPortion = roundToCents(scaledMatch * weight);
          indMatch.set(k, (indMatch.get(k) ?? 0) + matchPortion);
          indBal.set(k, (indBal.get(k) ?? 0) + matchPortion);
        }
      });
    } else {
      const catAll = indAccts.filter((ia) => ia.category === cat);
      const catPreTax = catAll.filter((ia) => ia.taxType === "preTax");
      const catMatchPool = catPreTax.length > 0 ? catPreTax : catAll;
      const catWithSpecs = catMatchPool.filter((ia) =>
        accountsWithSpecs.has(indKey(ia)),
      );
      const catAccts = catWithSpecs.length > 0 ? catWithSpecs : catMatchPool;
      const catTotal = catAccts.reduce(
        (s, ia) => s + (indBal.get(indKey(ia)) ?? 0),
        0,
      );
      for (const ia of catAccts) {
        const k = indKey(ia);
        const weight =
          catTotal > 0 ? (indBal.get(k) ?? 0) / catTotal : 1 / catAccts.length;
        const matchPortion = roundToCents(catMatch * weight);
        indMatch.set(k, (indMatch.get(k) ?? 0) + matchPortion);
        indBal.set(k, (indBal.get(k) ?? 0) + matchPortion);
      }
    }
  }

  // --- Step 4: Distribute overflow to brokerage accounts by allocationPriority ---
  if (overflowToBrokerage > 0) {
    const overflowSpecs = contributionSpecs
      .filter((s) => isOverflowTarget(s.category))
      .sort(
        (a, b) => (a.allocationPriority ?? 0) - (b.allocationPriority ?? 0),
      );
    const brokAccts = indAccts.filter((ia) => isOverflowTarget(ia.category));

    if (brokAccts.length > 0) {
      let remaining = overflowToBrokerage;
      for (const spec of overflowSpecs) {
        if (remaining <= 0) break;
        if (spec.targetAnnual == null || spec.targetAnnual <= 0) continue;
        const sk = specKeyOf(spec);
        const acctName = specToAccount.get(sk);
        if (!acctName) continue;
        const currentContrib = indContribs.get(acctName) ?? 0;
        const room = Math.max(0, spec.targetAnnual - currentContrib);
        const portion = roundToCents(Math.min(remaining, room));
        if (portion > 0) {
          indContribs.set(acctName, currentContrib + portion);
          indBal.set(acctName, (indBal.get(acctName) ?? 0) + portion);
          indOverflow.set(acctName, (indOverflow.get(acctName) ?? 0) + portion);
          remaining -= portion;
        }
      }
      if (remaining > 0) {
        const noTargetSpecs = overflowSpecs.filter(
          (s) => s.targetAnnual == null,
        );
        if (noTargetSpecs.length > 0) {
          const perAccount = roundToCents(remaining / noTargetSpecs.length);
          for (const spec of noTargetSpecs) {
            const acctName = specToAccount.get(specKeyOf(spec));
            if (!acctName) continue;
            indContribs.set(
              acctName,
              (indContribs.get(acctName) ?? 0) + perAccount,
            );
            indBal.set(acctName, (indBal.get(acctName) ?? 0) + perAccount);
            indOverflow.set(
              acctName,
              (indOverflow.get(acctName) ?? 0) + perAccount,
            );
          }
        } else {
          const lastSpec = overflowSpecs[overflowSpecs.length - 1];
          if (lastSpec) {
            const acctName = specToAccount.get(specKeyOf(lastSpec));
            if (acctName) {
              indContribs.set(
                acctName,
                (indContribs.get(acctName) ?? 0) + remaining,
              );
              indBal.set(acctName, (indBal.get(acctName) ?? 0) + remaining);
              indOverflow.set(
                acctName,
                (indOverflow.get(acctName) ?? 0) + remaining,
              );
            }
          }
        }
      }

      // Fallback: if remaining overflow wasn't routed (no matching specs),
      // distribute to joint/unowned brokerage accounts directly.
      if (remaining > 0) {
        const jointBrok = brokAccts.filter((ia) => ia.ownerPersonId == null);
        const fallbackAccts = jointBrok.length > 0 ? jointBrok : brokAccts;
        const perAcct = roundToCents(remaining / fallbackAccts.length);
        for (const ia of fallbackAccts) {
          const k = indKey(ia);
          indContribs.set(k, (indContribs.get(k) ?? 0) + perAcct);
          indBal.set(k, (indBal.get(k) ?? 0) + perAcct);
          indOverflow.set(k, (indOverflow.get(k) ?? 0) + perAcct);
        }
      }
    }
  }

  // --- Step 5: Track intentional contributions for source breakdown ---
  for (const spec of contributionSpecs) {
    if (!isOverflowTarget(spec.category)) continue;
    const acctName = specToAccount.get(specKeyOf(spec));
    if (!acctName) continue;
    let projected: number;
    if (spec.method === "percent_of_salary") {
      projected = roundToCents(
        projectedSalary * spec.salaryFraction * spec.value * proRate,
      );
    } else if (
      getAccountTypeConfig(spec.category).fixedContribScalesWithSalary
    ) {
      const salaryGrowthFactor =
        currentSalary > 0 ? projectedSalary / currentSalary : 1;
      projected = roundToCents(spec.baseAnnual * salaryGrowthFactor * proRate);
    } else {
      projected = roundToCents(spec.baseAnnual * lgf * proRate);
    }
    indIntentional.set(
      acctName,
      (indIntentional.get(acctName) ?? 0) + projected,
    );
  }

  // --- Step 6: Distribute ramp to brokerage accounts ---
  if (rampAmount > 0) {
    const brokWithSpecs = indAccts.filter(
      (ia) =>
        isOverflowTarget(ia.category) && accountsWithSpecs.has(indKey(ia)),
    );
    const brokAccts =
      brokWithSpecs.length > 0
        ? brokWithSpecs
        : indAccts.filter((ia) => isOverflowTarget(ia.category));
    const brokTotal = brokAccts.reduce(
      (s, ia) => s + (indBal.get(indKey(ia)) ?? 0),
      0,
    );
    for (const ia of brokAccts) {
      const k = indKey(ia);
      const weight =
        brokTotal > 0 ? (indBal.get(k) ?? 0) / brokTotal : 1 / brokAccts.length;
      const portion = roundToCents(rampAmount * weight);
      indContribs.set(k, (indContribs.get(k) ?? 0) + portion);
      indBal.set(k, (indBal.get(k) ?? 0) + portion);
      indRamp.set(k, (indRamp.get(k) ?? 0) + portion);
    }
  }

  return { indContribs, indMatch, indIntentional, indOverflow, indRamp };
}

// ---------------------------------------------------------------------------
// Brokerage Goal Withdrawal Distribution
// ---------------------------------------------------------------------------

/**
 * Distribute brokerage goal withdrawal across individual brokerage accounts.
 * Mutates `indBal` in place.
 */
export function distributeGoalWithdrawal(
  drawAmount: number,
  indAccts: IndividualAccountInput[],
  indKey: IndKeyFn,
  indBal: Map<string, number>,
): void {
  const brokAccts = indAccts.filter((ia) => isOverflowTarget(ia.category));
  const brokTotal = brokAccts.reduce(
    (s, ia) => s + (indBal.get(indKey(ia)) ?? 0),
    0,
  );
  for (const ia of brokAccts) {
    const k = indKey(ia);
    const weight =
      brokTotal > 0 ? (indBal.get(k) ?? 0) / brokTotal : 1 / brokAccts.length;
    indBal.set(k, roundToCents((indBal.get(k) ?? 0) - drawAmount * weight));
  }
}

// ---------------------------------------------------------------------------
// Decumulation: Distribute Withdrawals to Individual Accounts
// ---------------------------------------------------------------------------

/**
 * Distribute slot-level withdrawals to individual accounts proportionally.
 * For roth_traditional categories, routes traditional and roth withdrawals
 * separately to the correct tax-type accounts.
 *
 * Mutates `indBal` in place. Returns per-account withdrawal amounts.
 */
export function distributeWithdrawals(
  slots: DecumulationSlot[],
  indAccts: IndividualAccountInput[],
  indKey: IndKeyFn,
  indBal: Map<string, number>,
): Map<string, number> {
  const decIndWithdrawal = new Map<string, number>();

  for (const slot of slots) {
    if (slot.withdrawal <= 0) continue;
    const catAccts = indAccts.filter((ia) => ia.category === slot.category);
    const bs = getAccountTypeConfig(slot.category).balanceStructure;

    if (
      bs === "roth_traditional" &&
      (slot.traditionalWithdrawal > 0 || slot.rothWithdrawal > 0)
    ) {
      const tradAccts = catAccts.filter((ia) => ia.taxType === "preTax");
      const rothAccts = catAccts.filter((ia) => ia.taxType === "taxFree");

      // Distribute traditional withdrawal to preTax accounts (#33/#35)
      if (slot.traditionalWithdrawal > 0 && tradAccts.length > 0) {
        distributeProportionally(
          slot.traditionalWithdrawal,
          tradAccts,
          indKey,
          indBal,
          decIndWithdrawal,
        );
      }
      // Distribute roth withdrawal to taxFree accounts (#33/#35)
      if (slot.rothWithdrawal > 0 && rothAccts.length > 0) {
        distributeProportionally(
          slot.rothWithdrawal,
          rothAccts,
          indKey,
          indBal,
          decIndWithdrawal,
        );
      }
    } else {
      // Single-bucket / brokerage / fallback (#33/#35)
      if (catAccts.length > 0) {
        distributeProportionally(
          slot.withdrawal,
          catAccts,
          indKey,
          indBal,
          decIndWithdrawal,
        );
      }
    }
  }

  return decIndWithdrawal;
}

/**
 * Distribute an amount proportionally across accounts by balance.
 * Handles zero-balance safety (#33) and rounding residual (#35).
 * Mutates `indBal` and `withdrawalMap` in place.
 */
function distributeProportionally(
  amount: number,
  accounts: IndividualAccountInput[],
  indKey: IndKeyFn,
  indBal: Map<string, number>,
  withdrawalMap: Map<string, number>,
): void {
  const total = accounts.reduce(
    (s, ia) => s + Math.max(0, indBal.get(indKey(ia)) ?? 0),
    0,
  );
  if (total <= 0) return;

  let distributed = 0;
  let lastKey: string | null = null;
  for (const ia of accounts) {
    const k = indKey(ia);
    const bal = Math.max(0, indBal.get(k) ?? 0);
    if (bal <= 0) continue;
    lastKey = k;
    const wd = roundToCents(Math.min(amount * (bal / total), bal));
    indBal.set(k, roundToCents((indBal.get(k) ?? 0) - wd));
    withdrawalMap.set(k, (withdrawalMap.get(k) ?? 0) + wd);
    distributed += wd;
  }
  // Assign rounding residual to last account (#35)
  const residual = roundToCents(amount - distributed);
  if (residual > 0 && lastKey) {
    const cappedResidual = Math.min(
      residual,
      Math.max(0, indBal.get(lastKey) ?? 0),
    );
    indBal.set(
      lastKey,
      roundToCents((indBal.get(lastKey) ?? 0) - cappedResidual),
    );
    withdrawalMap.set(
      lastKey,
      (withdrawalMap.get(lastKey) ?? 0) + cappedResidual,
    );
  }
}

// ---------------------------------------------------------------------------
// Individual Account Growth
// ---------------------------------------------------------------------------

/**
 * Apply growth to individual account balances.
 * Mutates `indBal` in place. Returns per-account growth amounts.
 */
export function applyIndividualGrowth(
  indAccts: IndividualAccountInput[],
  indKey: IndKeyFn,
  indBal: Map<string, number>,
  effectiveReturn: number,
  clampNegative: boolean = false,
): Map<string, number> {
  const growthMap = new Map<string, number>();
  for (const ia of indAccts) {
    const k = indKey(ia);
    const prevBal = clampNegative
      ? Math.max(0, indBal.get(k) ?? 0)
      : (indBal.get(k) ?? 0);
    const growth = roundToCents(prevBal * effectiveReturn);
    growthMap.set(k, growth);
    indBal.set(k, roundToCents(prevBal + growth));
  }
  return growthMap;
}

// ---------------------------------------------------------------------------
// Individual Account Year Balance Construction
// ---------------------------------------------------------------------------

/**
 * Build individual account year balance records for output.
 */
export function buildIndividualYearBalances(
  indAccts: IndividualAccountInput[],
  indKey: IndKeyFn,
  indBal: Map<string, number>,
  indParentCat: Map<string, string>,
  phase: "accumulation" | "decumulation",
  maps: {
    contribs?: Map<string, number>;
    match?: Map<string, number>;
    growth?: Map<string, number>;
    withdrawal?: Map<string, number>;
    intentional?: Map<string, number>;
    overflow?: Map<string, number>;
    ramp?: Map<string, number>;
  },
): IndividualAccountYearBalance[] {
  return indAccts.map((ia) => {
    const k = indKey(ia);
    const isOverflow = isOverflowTarget(ia.category);
    const balance =
      Math.abs(indBal.get(k) ?? 0) < 1 ? 0 : roundToCents(indBal.get(k) ?? 0);

    if (phase === "accumulation") {
      return {
        name: ia.name,
        category: ia.category,
        taxType: ia.taxType,
        ownerName: ia.ownerName,
        ownerPersonId: ia.ownerPersonId,
        parentCategory: indParentCat.get(k),
        balance,
        contribution: maps.contribs?.get(k) ?? 0,
        employerMatch: maps.match?.get(k) ?? 0,
        growth: maps.growth?.get(k) ?? 0,
        ...(isOverflow
          ? {
              intentionalContribution: maps.intentional?.get(k) ?? 0,
              overflowContribution: maps.overflow?.get(k) ?? 0,
              rampContribution: maps.ramp?.get(k) ?? 0,
            }
          : {}),
      };
    }

    return {
      name: ia.name,
      category: ia.category,
      taxType: ia.taxType,
      ownerName: ia.ownerName,
      ownerPersonId: ia.ownerPersonId,
      parentCategory: indParentCat.get(k),
      balance,
      contribution: maps.contribs?.get(k) ?? 0,
      employerMatch: 0,
      growth: maps.growth?.get(k) ?? 0,
      withdrawal: maps.withdrawal?.get(k) ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Clamping
// ---------------------------------------------------------------------------

/**
 * Clamp individual account balances to zero (rounding can create small negatives).
 * Mutates `indBal` in place.
 */
export function clampIndividualBalances(
  indAccts: IndividualAccountInput[],
  indKey: IndKeyFn,
  indBal: Map<string, number>,
): void {
  for (const ia of indAccts) {
    const k = indKey(ia);
    const v = indBal.get(k) ?? 0;
    if (v < 0) indBal.set(k, 0);
  }
}
