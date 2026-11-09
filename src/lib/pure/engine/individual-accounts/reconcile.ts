/** The individual track at year end: each account's row, negatives clamped,
 *  each category reconciled to `accountBalance`, basis clamped to the balance. */
import type {
  IndividualAccountYearBalance,
  IndividualAccountInput,
  AccountBalances,
  AccountYearDraw,
  AccountYearRothBasis,
} from "../../accounts/account-balances.types";
import { roundToCents } from "../../../utils/math";
import {
  getAccountTypeConfig,
  isOverflowTarget,
  getAllCategories,
  isPreTaxType,
  isTaxFreeBucket,
  isRetirementMoney,
} from "../../../config/account-types";
import {
  getTraditionalBalance,
  getRothBalance,
  getTotalBalance,
} from "../../../config/account-balance";
import type { EligibilityRecord } from "@/lib/pure/accounts/eligibility";
import type { IndKeyFn } from "@/lib/pure/accounts/account-part";
import {
  clampBasisToBalance,
  type RothBasisState,
  type BasisDraw,
} from "@/lib/pure/accounts/roth-basis-tracking";

/**
 * Builds per-account year records. `eligibility` (decumulation) passes through lock state and
 * reason; `maps.basis`/`maps.draws` fill the Roth basis fields from end-of-year `indBasis`.
 */
export function buildIndividualYearBalances(
  indAccounts: IndividualAccountInput[],
  indKey: IndKeyFn,
  indBalance: Map<string, number>,
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
    basis?: Map<string, RothBasisState>;
    draws?: Map<string, BasisDraw>;
    /** Brokerage cost basis per account (brokerage-basis.ts). */
    brokerageBasis?: Map<string, number>;
  },
  eligibility?: EligibilityRecord,
): IndividualAccountYearBalance[] {
  const drawFor = (k: string): AccountYearDraw => {
    const accountEligibility = eligibility?.byKey.get(k);
    return {
      withdrawal: maps.withdrawal?.get(k) ?? 0,
      ...(accountEligibility
        ? {
            // "Locked" means every dollar is penalty-exposed; a partially
            // exposed account is not locked (eligibility.ts docblock).
            eligibilityLocked:
              accountEligibility.penaltyFreeAmount <= 0.005 &&
              accountEligibility.penaltyExposedAmount > 0,
            reason: accountEligibility.reason,
            // Start-of-year capacity (before this year's withdrawals and
            // growth) — the same numbers routing used.
            penaltyFreeAmount: accountEligibility.penaltyFreeAmount,
            penaltyExposedAmount: accountEligibility.penaltyExposedAmount,
            allowPenalizedWithdrawals:
              accountEligibility.allowPenalizedWithdrawals,
          }
        : {}),
    };
  };
  // The roth group, when this account has any of its fields.
  const rothFields = (roth: AccountYearRothBasis) =>
    Object.keys(roth).length > 0 ? { roth } : {};
  const rows = indAccounts.map((ia): IndividualAccountYearBalance => {
    const k = indKey(ia);
    const isOverflow = isOverflowTarget(ia.category);
    const projectedFields = ia.projectedOnly ? { projectedOnly: true } : {};
    const balance =
      Math.abs(indBalance.get(k) ?? 0) < 1
        ? 0
        : roundToCents(indBalance.get(k) ?? 0);
    const basisState = maps.basis?.get(k);
    const basisFields: AccountYearRothBasis = basisState
      ? {
          basisRemaining: roundToCents(
            basisState.contributionBasis + basisState.conversionBasis,
          ),
          contributionBasisRemaining: roundToCents(
            basisState.contributionBasis,
          ),
          conversionBasisRemaining: roundToCents(basisState.conversionBasis),
          basisUncertain: basisState.stale || basisState.isSeeded,
        }
      : {};
    const brokerageBasis = maps.brokerageBasis?.get(k);
    const costBasisFields =
      brokerageBasis != null
        ? { costBasis: roundToCents(Math.min(brokerageBasis, balance)) }
        : {};
    const basisDraw = maps.draws?.get(k);
    const drawnFields: AccountYearRothBasis =
      basisDraw != null
        ? {
            basisDrawn: roundToCents(
              basisDraw.contributionDrawn + basisDraw.conversionDrawn,
            ),
          }
        : {};

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
        ...costBasisFields,
        ...projectedFields,
        // A year a paycheck is gone draws too (gap-year-draw.ts): the same
        // draw, eligibility and basis fields a retirement year has.
        ...(maps.withdrawal ? { draw: drawFor(k) } : {}),
        ...rothFields(
          maps.withdrawal ? { ...basisFields, ...drawnFields } : basisFields,
        ),
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
      draw: drawFor(k),
      ...rothFields({ ...basisFields, ...drawnFields }),
      ...costBasisFields,
      ...projectedFields,
    };
  });
  // The projection-only retirement brokerage shows up once it holds money
  // (an empty "projected" account would be noise in every table).
  return rows.filter(
    (r) =>
      !r.projectedOnly ||
      r.balance !== 0 ||
      r.contribution !== 0 ||
      (r.draw?.withdrawal ?? 0) !== 0,
  );
}

/**
 * Clamp individual account balances to zero (rounding can create small negatives).
 * Mutates `indBalance` in place.
 */
export function clampIndividualBalances(
  indAccounts: IndividualAccountInput[],
  indKey: IndKeyFn,
  indBalance: Map<string, number>,
): void {
  for (const ia of indAccounts) {
    const k = indKey(ia);
    const v = indBalance.get(k) ?? 0;
    if (v < 0) indBalance.set(k, 0);
  }
}

/**
 * Pushes `indBalance` onto the authoritative `accountBalance` each year so eligibility sees
 * matching tracks; no writes when a group already matches. Run after `clampIndividualBalances`,
 * before `clampIndividualBasis`. Mutates `indBalance`; returns drift (>$1) diagnostics.
 */
export function reconcileIndividualToAggregate(
  indAccounts: IndividualAccountInput[],
  indKey: IndKeyFn,
  indBalance: Map<string, number>,
  accountBalance: AccountBalances,
): string[] {
  const diagnostics: string[] = [];
  for (const cat of getAllCategories()) {
    const catAccounts = indAccounts.filter((ia) => ia.category === cat);
    if (catAccounts.length === 0) continue;
    const bs = getAccountTypeConfig(cat).balanceStructure;
    if (bs === "roth_traditional") {
      reconcileGroup(
        catAccounts.filter((ia) => isPreTaxType(ia.taxType)),
        indKey,
        indBalance,
        getTraditionalBalance(accountBalance[cat]),
        `${cat} traditional`,
        diagnostics,
      );
      reconcileGroup(
        catAccounts.filter((ia) => isTaxFreeBucket(ia.taxType)),
        indKey,
        indBalance,
        getRothBalance(accountBalance[cat]),
        `${cat} Roth`,
        diagnostics,
      );
    } else {
      reconcileGroup(
        catAccounts,
        indKey,
        indBalance,
        getTotalBalance(accountBalance[cat]),
        cat,
        diagnostics,
      );
    }
  }
  return diagnostics;
}

/** One (category, tax-slice) group's reconciliation. Retirement money absorbs the drift; a
 *  shortfall takes from Portfolio accounts only after retirement money is empty. With no
 *  weight the group is left alone. */
function reconcileGroup(
  groupAccounts: IndividualAccountInput[],
  indKey: IndKeyFn,
  indBalance: Map<string, number>,
  target: number,
  label: string,
  diagnostics: string[],
): void {
  if (groupAccounts.length === 0) return;
  const balance = (ia: IndividualAccountInput) =>
    Math.max(0, indBalance.get(indKey(ia)) ?? 0);
  const sumOf = (accounts: IndividualAccountInput[]) =>
    accounts.reduce((s, ia) => s + balance(ia), 0);
  const sumInd = sumOf(groupAccounts);
  const delta = roundToCents(target - sumInd);
  if (delta === 0) return;

  if (Math.abs(delta) > 1) {
    diagnostics.push(
      `[DIAG] indBal/acctBal reconciliation: ${label} drifted by $${delta.toFixed(2)} (indBal sum $${sumInd.toFixed(2)} vs acctBal $${target.toFixed(2)})`,
    );
  }

  const retirement = groupAccounts.filter((ia) =>
    isRetirementMoney(ia.parentCategory),
  );
  const portfolio = groupAccounts.filter(
    (ia) => !isRetirementMoney(ia.parentCategory),
  );

  // Spread `amount` over `accounts` by balance (equally when they hold
  // nothing and `equalWhenEmpty`); returns what couldn't be placed.
  const spread = (
    accounts: IndividualAccountInput[],
    amount: number,
    equalWhenEmpty: boolean,
  ): number => {
    if (accounts.length === 0 || amount === 0) return amount;
    const total = sumOf(accounts);
    if (total <= 0 && !equalWhenEmpty) return amount;
    let distributed = 0;
    let largestKey: string | null = null;
    let largestBalance = -Infinity;
    for (const ia of accounts) {
      const k = indKey(ia);
      const b = balance(ia);
      if (b > largestBalance) {
        largestBalance = b;
        largestKey = k;
      }
      const share = roundToCents(
        amount * (total > 0 ? b / total : 1 / accounts.length),
      );
      const newBalance = Math.max(0, roundToCents(b + share));
      indBalance.set(k, newBalance);
      distributed += roundToCents(newBalance - b);
    }
    const residual = roundToCents(amount - distributed);
    if (residual !== 0 && largestKey) {
      const b = Math.max(0, indBalance.get(largestKey) ?? 0);
      const newBalance = Math.max(0, roundToCents(b + residual));
      indBalance.set(largestKey, newBalance);
      return roundToCents(residual - (newBalance - b));
    }
    return 0;
  };

  let unplaced: number;
  if (portfolio.length === 0 || retirement.length === 0) {
    unplaced = spread(groupAccounts, delta, false);
  } else if (delta > 0) {
    unplaced = spread(retirement, delta, true);
  } else {
    // Retirement money first, the remainder from Portfolio.
    const fromRetirement = Math.max(delta, -sumOf(retirement));
    const left = spread(retirement, fromRetirement, false);
    unplaced = spread(
      portfolio,
      roundToCents(delta - fromRetirement + left),
      false,
    );
  }

  if (unplaced !== 0 && sumOf(groupAccounts) <= 0 && target > 0) {
    // No weight to distribute by — inventing one would be a second
    // allocation policy. Leave indBalance alone; the diagnostic above (for
    // >$1 drift) already surfaces this if it's material.
    if (Math.abs(delta) <= 1) {
      diagnostics.push(
        `[DIAG] indBal/acctBal reconciliation: ${label} has $${target.toFixed(2)} in acctBal but no individual-account balance to distribute it across — left unreconciled`,
      );
    }
  }
}

/**
 * Clamps tracked Roth basis to each account's final (clamped, dust-cleaned) balance. Run after
 * balance clamping. Mutates `indBasis`.
 */
export function clampIndividualBasis(
  indAccounts: IndividualAccountInput[],
  indKey: IndKeyFn,
  indBasis: Map<string, RothBasisState>,
  indBalance: Map<string, number>,
): void {
  for (const ia of indAccounts) {
    const k = indKey(ia);
    const state = indBasis.get(k);
    if (!state) continue;
    const balance = Math.max(0, indBalance.get(k) ?? 0);
    indBasis.set(k, clampBasisToBalance(state, balance));
  }
}
