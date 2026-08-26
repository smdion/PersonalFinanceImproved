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
  AccountBalances,
} from "../types";
import { roundToCents } from "../../utils/math";
import {
  getAccountTypeConfig,
  isOverflowTarget,
  getAllCategories,
  isPreTaxType,
  isTaxFreeBucket,
  getTraditionalBalance,
  getRothBalance,
  getTotalBalance,
} from "../../config/account-types";
import { TAX_TREATMENT_TO_TAX_TYPE } from "../../config/display-labels";
import { projectSpecAmount } from "./contribution-projection";
import type { EligibilityRecord } from "@/lib/pure/withdrawal-eligibility";
import {
  accrueContributionBasis,
  drawFromBasis,
  applyBasisDraw,
  clampBasisToBalance,
  type RothBasisState,
  type BasisDraw,
} from "@/lib/pure/roth-basis-tracking";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Composite key function for individual accounts. */
export type IndKeyFn = (ia: {
  name: string;
  category: string;
  taxType: string;
  ownerPersonId?: number;
}) => string;

/** Creates the standard composite key function.
 *
 * Includes `ownerPersonId` (v0.7.8, PLAN-v0.7.8-v4 Group 1 prerequisite,
 * advisor finding S3): two different people's accounts that happen to share
 * a display name within the same category/taxType previously collided into
 * one `indBal` entry, silently merging their balances and keeping only one
 * owner's ID. Eligibility gating (Rule of 55, 59½, etc.) is per-owner, so
 * that collision would resolve the wrong person's access for the merged
 * money. A joint account (`ownerPersonId` undefined) still keys on `"joint"`
 * — unchanged from before, since joint accounts have no per-owner
 * eligibility question to get wrong. */
export function makeIndKey(): IndKeyFn {
  return (ia) =>
    `${ia.name}::${ia.category}::${ia.taxType}::${ia.ownerPersonId ?? "joint"}`;
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
    const projected = roundToCents(
      projectSpecAmount(spec, {
        projectedSalary,
        salaryBase: currentSalary,
        limitGrowthFactor: lgf,
        proRate,
      }),
    );
    specRaw.set(sk, projected);
    specAcct.set(sk, acctName);
  }

  // --- Step 2: Distribute slot totals to individual accounts using spec weights ---
  // Fixed-amount specs are pre-allocated directly; remaining slot total is distributed
  // proportionally among scales-with-salary specs.
  for (const slot of slots) {
    const bs = getAccountTypeConfig(slot.category).balanceStructure;
    const catSpecs = contributionSpecs.filter(
      (s) => s.category === slot.category,
    );

    const distributeSpecs = (specs: typeof catSpecs, slotAmount: number) => {
      // Separate fixed-amount specs from scaling specs
      const fixedSpecs = specs.filter(
        (s) => s.contributionScaling === "fixed_amount",
      );
      const scalingSpecs = specs.filter(
        (s) => s.contributionScaling !== "fixed_amount",
      );

      // Pre-allocate fixed specs their raw amount (capped at slot total)
      let remaining = slotAmount;
      for (const sp of fixedSpecs) {
        const sk = specKeyOf(sp);
        const acctName = specAcct.get(sk);
        if (!acctName) continue;
        const rawAmount = specRaw.get(sk) ?? 0;
        const portion = roundToCents(Math.min(rawAmount, remaining));
        if (portion <= 0) continue;
        indContribs.set(acctName, (indContribs.get(acctName) ?? 0) + portion);
        indBal.set(acctName, (indBal.get(acctName) ?? 0) + portion);
        remaining -= portion;
      }

      // Distribute remaining proportionally among scaling specs
      if (scalingSpecs.length > 0 && remaining > 0) {
        const rawTotal = scalingSpecs.reduce(
          (s, sp) => s + (specRaw.get(specKeyOf(sp)) ?? 0),
          0,
        );
        for (const sp of scalingSpecs) {
          const sk = specKeyOf(sp);
          const acctName = specAcct.get(sk);
          if (!acctName) continue;
          const weight =
            rawTotal > 0
              ? (specRaw.get(sk) ?? 0) / rawTotal
              : 1 / scalingSpecs.length;
          const portion = roundToCents(remaining * weight);
          indContribs.set(acctName, (indContribs.get(acctName) ?? 0) + portion);
          indBal.set(acctName, (indBal.get(acctName) ?? 0) + portion);
        }
      } else if (fixedSpecs.length === 0) {
        // All specs are scaling (original behavior) — fallback for no fixed specs
        const rawTotal = specs.reduce(
          (s, sp) => s + (specRaw.get(specKeyOf(sp)) ?? 0),
          0,
        );
        for (const sp of specs) {
          const sk = specKeyOf(sp);
          const acctName = specAcct.get(sk);
          if (!acctName) continue;
          const weight =
            rawTotal > 0 ? (specRaw.get(sk) ?? 0) / rawTotal : 1 / specs.length;
          const portion = roundToCents(slotAmount * weight);
          indContribs.set(acctName, (indContribs.get(acctName) ?? 0) + portion);
          indBal.set(acctName, (indBal.get(acctName) ?? 0) + portion);
        }
      }
    };

    if (bs === "roth_traditional") {
      for (const [taxTreatment, slotAmount] of [
        ["pre_tax", slot.traditionalContrib],
        ["tax_free", slot.rothContrib],
      ] as const) {
        const typeSpecs = catSpecs.filter(
          (s) => s.taxTreatment === taxTreatment,
        );
        distributeSpecs(typeSpecs, slotAmount);
      }
    } else {
      distributeSpecs(catSpecs, slot.employeeContrib);
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
        const preTaxPCatAccts = allPCatAccts.filter((ia) =>
          isPreTaxType(ia.taxType),
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
      const catPreTax = catAll.filter((ia) => isPreTaxType(ia.taxType));
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
    const projected = roundToCents(
      projectSpecAmount(spec, {
        projectedSalary,
        salaryBase: currentSalary,
        limitGrowthFactor: lgf,
        proRate,
      }),
    );
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
 * `eligibility` (v0.7.8, PLAN-v0.7.8-v4 Group 2.2, Tier A) — when provided,
 * prefers eligible (not-yet-penalty-exposed) accounts within each
 * category/tax-slot before reaching into penalty-exposed ones. Has no
 * config lever, always applies: this is the fan-out-only preference,
 * distinct from and independent of `avoidPenalizedWithdrawals`'s
 * cross-category `routeForMode` behavior (Tier B) — it only ever changes
 * WHICH account inside an already-decided category/slot supplies a given
 * dollar, never the slot totals themselves. Locked design:
 * `.scratch/docs/plans/DESIGN-DECISION-v0.7.8-withdrawal-ordering-group0.md`
 * § Q1 Tier A.
 *
 * Mutates `indBal` in place. Returns per-account withdrawal amounts.
 */
/**
 * Distributes each slot's withdrawal across the individual accounts in its
 * category/tax-slice. Returns the per-account amounts plus any shortfall
 * warnings (v0.7.8 indBal reconciliation follow-up,
 * DESIGN-DECISION-v0.7.8-indbal-reconciliation.md § Q3) — a warning means
 * `Σ decIndWithdrawal` for that slot came up short of `slot.withdrawal`
 * because the individual-account track's balance was genuinely exhausted,
 * not silently discarded as it was before this pass. With
 * `reconcileIndividualToAggregate` running at end of year, this should be
 * an empty array for every fixture; a non-empty one is a real finding.
 */
export function distributeWithdrawals(
  slots: DecumulationSlot[],
  indAccts: IndividualAccountInput[],
  indKey: IndKeyFn,
  indBal: Map<string, number>,
  eligibility?: EligibilityRecord,
): { decIndWithdrawal: Map<string, number>; warnings: string[] } {
  const decIndWithdrawal = new Map<string, number>();
  const warnings: string[] = [];
  const reportShortfall = (shortfall: number, label: string) => {
    if (shortfall <= 0.005) return;
    warnings.push(
      `Individual-account shortfall: $${shortfall.toFixed(2)} of ${label} withdrawal could not be allocated to any tracked account`,
    );
  };

  for (const slot of slots) {
    if (slot.withdrawal <= 0) continue;
    const catAccts = indAccts.filter((ia) => ia.category === slot.category);
    const bs = getAccountTypeConfig(slot.category).balanceStructure;

    if (
      bs === "roth_traditional" &&
      (slot.traditionalWithdrawal > 0 || slot.rothWithdrawal > 0)
    ) {
      const tradAccts = catAccts.filter((ia) => isPreTaxType(ia.taxType));
      const rothAccts = catAccts.filter((ia) => isTaxFreeBucket(ia.taxType));

      // Distribute traditional withdrawal to preTax accounts (#33/#35)
      if (slot.traditionalWithdrawal > 0 && tradAccts.length > 0) {
        reportShortfall(
          distributeProportionallyPreferringPenaltyFree(
            slot.traditionalWithdrawal,
            tradAccts,
            indKey,
            indBal,
            decIndWithdrawal,
            eligibility,
          ),
          `${slot.category} traditional`,
        );
      }
      // Distribute roth withdrawal to taxFree accounts (#33/#35)
      if (slot.rothWithdrawal > 0 && rothAccts.length > 0) {
        reportShortfall(
          distributeProportionallyPreferringPenaltyFree(
            slot.rothWithdrawal,
            rothAccts,
            indKey,
            indBal,
            decIndWithdrawal,
            eligibility,
          ),
          `${slot.category} Roth`,
        );
      }
    } else {
      // Single-bucket / brokerage / fallback (#33/#35)
      if (catAccts.length > 0) {
        reportShortfall(
          distributeProportionallyPreferringPenaltyFree(
            slot.withdrawal,
            catAccts,
            indKey,
            indBal,
            decIndWithdrawal,
            eligibility,
          ),
          slot.category,
        );
      }
    }
  }

  return { decIndWithdrawal, warnings };
}

/**
 * Wraps `distributeProportionally` with a penalty-free-first, penalty-
 * exposed-second two-pass split (Tier A — see `distributeWithdrawals`'s
 * docblock). v0.7.8 penalty-hard-exclusion follow-up
 * (DESIGN-DECISION-v0.7.8-penalty-hard-exclusion.md § Q2 point 3):
 * previously partitioned accounts by a whole-account "locked" boolean; now
 * partitions PER DOLLAR, using each account's own `penaltyFreeAmount` as a
 * draw ceiling rather than sorting whole accounts into two buckets — the
 * exact fix for the reported bug (a Roth IRA with some contribution basis
 * was never whole-account "locked", so its penalty-exposed growth was
 * reachable by the old partition even though the account was only
 * PARTIALLY penalty-free).
 *
 * Tier A has no config lever and always applies — it only decides which
 * INDIVIDUAL ACCOUNT within a category receives a category-level total
 * `routeForMode` already decided; when `avoidPenalizedWithdrawals` is on
 * (default), that category total already excludes penalty-exposed money
 * entirely, so the second (penalty-exposed) draw below should be
 * mathematically unreachable in the default configuration — reached only
 * when the household has the lever off, mirroring today's un-excluded
 * total.
 *
 * Falls through to a single unchanged `distributeProportionally` call
 * whenever the partition would be a no-op (no `exposure` passed, nothing
 * penalty-exposed at all, or nothing penalty-exposed among *this specific*
 * account list) — that fallthrough is what keeps a
 * nothing-penalty-exposed household's output byte-identical, not a
 * separate code path that has to be kept in sync.
 */
function distributeProportionallyPreferringPenaltyFree(
  amount: number,
  accounts: IndividualAccountInput[],
  indKey: IndKeyFn,
  indBal: Map<string, number>,
  withdrawalMap: Map<string, number>,
  exposure: EligibilityRecord | undefined,
): number {
  if (!exposure || exposure.totalPenaltyExposed === 0) {
    return distributeProportionally(
      amount,
      accounts,
      indKey,
      indBal,
      withdrawalMap,
    );
  }
  const hasExposureInList = accounts.some(
    (ia) => (exposure.byKey.get(indKey(ia))?.penaltyExposedAmount ?? 0) > 0,
  );
  if (!hasExposureInList) {
    return distributeProportionally(
      amount,
      accounts,
      indKey,
      indBal,
      withdrawalMap,
    );
  }
  // First pass: draw only against each account's own penalty-free capacity
  // (never more than its current balance).
  const penaltyFreeCapacity = new Map<string, number>(
    accounts.map((ia) => {
      const k = indKey(ia);
      const bal = Math.max(0, indBal.get(k) ?? 0);
      const acctExposure = exposure.byKey.get(k);
      return [
        k,
        acctExposure ? Math.min(bal, acctExposure.penaltyFreeAmount) : bal,
      ];
    }),
  );
  const shortfall = distributeProportionally(
    amount,
    accounts,
    indKey,
    indBal,
    withdrawalMap,
    penaltyFreeCapacity,
  );
  if (shortfall <= 0) return 0;
  // Residual reaches into penalty-exposed capacity — no capacity ceiling
  // here, whatever balance remains at this point IS the exposed portion.
  return distributeProportionally(
    shortfall,
    accounts,
    indKey,
    indBal,
    withdrawalMap,
  );
}

/**
 * Distribute an amount proportionally across accounts by balance (or, when
 * `capacity` is supplied, by `min(balance, capacity)` per account — v0.7.8
 * penalty-hard-exclusion follow-up, used by
 * `distributeProportionallyPreferringPenaltyFree` to draw against only the
 * penalty-free portion of each account's balance). Handles zero-balance
 * safety (#33) and rounding residual (#35 — v0.7.8 indBal reconciliation
 * follow-up, DESIGN-DECISION-v0.7.8-indbal-reconciliation.md § Q3, replaced
 * the old single lastKey-only assignment with a bounded re-routing loop
 * across the whole group, so a residual that the first account can't fully
 * absorb re-routes to the next one with capacity instead of being silently
 * capped away). Mutates `indBal` and `withdrawalMap` in place. Returns any
 * amount that could not be allocated because the group's capacity was
 * genuinely exhausted — 0 in the overwhelmingly common case.
 */
function distributeProportionally(
  amount: number,
  accounts: IndividualAccountInput[],
  indKey: IndKeyFn,
  indBal: Map<string, number>,
  withdrawalMap: Map<string, number>,
  capacity?: Map<string, number>,
): number {
  const room = (k: string): number => {
    const bal = Math.max(0, indBal.get(k) ?? 0);
    const c = capacity?.get(k);
    return c != null ? Math.max(0, Math.min(bal, c)) : bal;
  };
  const total = accounts.reduce((s, ia) => s + room(indKey(ia)), 0);
  if (total <= 0) return amount;

  let distributed = 0;
  for (const ia of accounts) {
    const k = indKey(ia);
    const r = room(k);
    if (r <= 0) continue;
    const wd = roundToCents(Math.min(amount * (r / total), r));
    if (wd <= 0) continue;
    indBal.set(k, roundToCents((indBal.get(k) ?? 0) - wd));
    withdrawalMap.set(k, (withdrawalMap.get(k) ?? 0) + wd);
    distributed += wd;
  }

  // Re-route any rounding residual within the same account group instead of
  // a single lastKey assignment — iterate in the same deterministic order,
  // drawing what's left from each account with remaining capacity, until
  // the residual is placed or the group's capacity is genuinely exhausted.
  let remaining = roundToCents(amount - distributed);
  for (const ia of accounts) {
    if (remaining <= 0) break;
    const k = indKey(ia);
    const r = room(k);
    if (r <= 0) continue;
    const draw = roundToCents(Math.min(remaining, r));
    if (draw <= 0) continue;
    indBal.set(k, roundToCents((indBal.get(k) ?? 0) - draw));
    withdrawalMap.set(k, (withdrawalMap.get(k) ?? 0) + draw);
    remaining = roundToCents(remaining - draw);
  }

  return Math.max(0, remaining);
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
// Tracked Roth Basis (v0.7.8 follow-up)
// ---------------------------------------------------------------------------
//
// Thin per-account loops — all arithmetic delegates to the pure module
// (@/lib/pure/roth-basis-tracking). This "aspect module" (see file
// docblock) branches on isTaxFreeBucket + rothOrderingRules and calls the
// pure functions; it owns no basis math of its own.

/**
 * Grows tracked basis by this accumulation year's contributions.
 * `indContribs` is the same map `distributeContributions` returns —
 * already excludes employer match (see roth-basis-tracking.ts's
 * docblock for why that exclusion is load-bearing). Mutates `indBasis`
 * in place; no-op for accounts with no entry (non-Roth accounts never
 * get one — see `buildProjectionState`).
 */
export function accrueIndividualBasis(
  indAccts: IndividualAccountInput[],
  indKey: IndKeyFn,
  indBasis: Map<string, RothBasisState>,
  indContribs: Map<string, number>,
): void {
  for (const ia of indAccts) {
    const k = indKey(ia);
    const state = indBasis.get(k);
    if (!state) continue;
    const contribution = indContribs.get(k) ?? 0;
    indBasis.set(k, accrueContributionBasis(state, contribution));
  }
}

/**
 * Depletes tracked basis by however much of each account's withdrawal
 * this year was actually basis, per the account category's own
 * `rothOrderingRules`. Must run AFTER `distributeWithdrawals` — needs
 * both the pre-withdrawal balance (for the pro-rata ratio) and the actual
 * per-account withdrawal amount it returned. Mutates `indBasis` in place.
 * Returns the per-account `BasisDraw`s for the caller to attach to
 * `buildIndividualYearBalances`'s output (`rothBasisDrawn`).
 */
export function depleteIndividualBasis(input: {
  indAccts: IndividualAccountInput[];
  indKey: IndKeyFn;
  indBasis: Map<string, RothBasisState>;
  preWithdrawalBal: Map<string, number>;
  withdrawals: Map<string, number>;
}): Map<string, BasisDraw> {
  const { indAccts, indKey, indBasis, preWithdrawalBal, withdrawals } = input;
  const draws = new Map<string, BasisDraw>();
  for (const ia of indAccts) {
    const k = indKey(ia);
    const state = indBasis.get(k);
    if (!state) continue;
    const withdrawal = withdrawals.get(k) ?? 0;
    if (withdrawal <= 0) continue;
    const orderingRule = getAccountTypeConfig(ia.category).rothOrderingRules;
    if (orderingRule !== "basis_first" && orderingRule !== "pro_rata") continue;
    const draw = drawFromBasis({
      state,
      orderingRule,
      balanceBeforeWithdrawal: preWithdrawalBal.get(k) ?? 0,
      withdrawal,
    });
    draws.set(k, draw);
    indBasis.set(k, applyBasisDraw(state, draw));
  }
  return draws;
}

// ---------------------------------------------------------------------------
// Individual Account Year Balance Construction
// ---------------------------------------------------------------------------

/**
 * Build individual account year balance records for output.
 *
 * `eligibility` (decumulation only; v0.7.8, PLAN-v0.7.8-v4 follow-up) —
 * when provided, each output record's `eligibilityLocked`/`eligibilityReason`
 * are read straight from the matching `AccountEligibility` entry, so the
 * UI can show why the engine did or didn't prefer an account this year.
 * Purely a read/pass-through here — this module never computes eligibility
 * itself (see `@/lib/pure/withdrawal-eligibility`).
 *
 * `maps.basis`/`maps.draws` (tracked Roth basis follow-up) — when
 * provided, populate `rothBasisRemaining`/`rothBasisDrawn`/
 * `rothBasisUncertain`. Called AFTER accrual (accumulation) or depletion
 * (decumulation) has already run for this year, so this reads end-of-year
 * state directly out of `indBasis` — no `start − drawn` recomputation to
 * drift out of sync with it.
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
    basis?: Map<string, RothBasisState>;
    draws?: Map<string, BasisDraw>;
  },
  eligibility?: EligibilityRecord,
): IndividualAccountYearBalance[] {
  return indAccts.map((ia) => {
    const k = indKey(ia);
    const isOverflow = isOverflowTarget(ia.category);
    const balance =
      Math.abs(indBal.get(k) ?? 0) < 1 ? 0 : roundToCents(indBal.get(k) ?? 0);
    const basisState = maps.basis?.get(k);
    const basisFields = basisState
      ? {
          rothBasisRemaining: roundToCents(
            basisState.contributionBasis + basisState.conversionBasis,
          ),
          rothBasisUncertain: basisState.stale || basisState.isSeeded,
        }
      : {};
    const draw = maps.draws?.get(k);
    const drawnFields =
      draw != null
        ? {
            rothBasisDrawn: roundToCents(
              draw.contributionDrawn + draw.conversionDrawn,
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
        ...basisFields,
      };
    }

    const acctEligibility = eligibility?.byKey.get(k);
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
      ...(acctEligibility
        ? {
            // "Locked" (whole-account, backward-compatible UI meaning) —
            // every dollar in the account is penalty-exposed. A PARTIALLY
            // exposed account (some penalty-free capacity remaining) is
            // NOT locked under this definition, even though it now has a
            // nonzero penaltyExposedAmount — see withdrawal-eligibility.ts's
            // module docblock § Q2.
            eligibilityLocked:
              acctEligibility.penaltyFreeAmount <= 0.005 &&
              acctEligibility.penaltyExposedAmount > 0,
            eligibilityReason: acctEligibility.reason,
          }
        : {}),
      ...basisFields,
      ...drawnFields,
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

/**
 * Reconciles the per-individual-account track (`indBal`) to the aggregate
 * track (`acctBal`) once per projected year, so `Σ indBal[cat] ===
 * acctBal[cat]` exactly before the NEXT year's withdrawal-eligibility
 * computation runs (v0.7.8 follow-up,
 * DESIGN-DECISION-v0.7.8-indbal-reconciliation.md § Q1(c)/Q2).
 *
 * The two tracks are deliberately separate (different granularity, lifecycle,
 * consumers — see the design doc's Q2) but drift accumulates from per-account
 * `roundToCents` vs. one aggregate rounding at several pipeline stages, and
 * that drift compounds across years via growth. Left unreconciled, a
 * category that `computeWithdrawalEligibility` (summing over `indBal`)
 * reports as 100% locked can still show a nonzero "eligible" balance to
 * `subtractPenaltyExposed` (which reads `acctBal`) — the exact live bug this
 * function exists to close.
 *
 * `acctBal` is the authoritative track (it feeds Tax Buckets, routing, tax,
 * and every aggregate the UI shows) — this pushes `indBal` onto it, never
 * the reverse. Zero writes when a group already matches, which is what
 * keeps a non-drifting household's projection byte-identical (Q3 of the
 * ORIGINAL Group 0 design doc forbade deriving eligibility from a sum of
 * `indBal`; this does not do that — it corrects `indBal` itself, off the
 * authoritative track, before eligibility ever reads it).
 *
 * Call at END of year, after `clampIndividualBalances` (itself a drift
 * source — it zeroes negatives on the individual track only) and before
 * `clampIndividualBasis` (so tracked basis re-clamps to the reconciled
 * balance). Mutates `indBal` in place. Returns diagnostic strings — empty
 * in the overwhelmingly common case; a dollar-scale (>$1) drift is a
 * structural finding, not rounding, and is surfaced rather than silently
 * absorbed.
 */
export function reconcileIndividualToAggregate(
  indAccts: IndividualAccountInput[],
  indKey: IndKeyFn,
  indBal: Map<string, number>,
  acctBal: AccountBalances,
): string[] {
  const diagnostics: string[] = [];
  for (const cat of getAllCategories()) {
    const catAccts = indAccts.filter((ia) => ia.category === cat);
    if (catAccts.length === 0) continue;
    const bs = getAccountTypeConfig(cat).balanceStructure;
    if (bs === "roth_traditional") {
      reconcileGroup(
        catAccts.filter((ia) => isPreTaxType(ia.taxType)),
        indKey,
        indBal,
        getTraditionalBalance(acctBal[cat]),
        `${cat} traditional`,
        diagnostics,
      );
      reconcileGroup(
        catAccts.filter((ia) => isTaxFreeBucket(ia.taxType)),
        indKey,
        indBal,
        getRothBalance(acctBal[cat]),
        `${cat} Roth`,
        diagnostics,
      );
    } else {
      reconcileGroup(
        catAccts,
        indKey,
        indBal,
        getTotalBalance(acctBal[cat]),
        cat,
        diagnostics,
      );
    }
  }
  return diagnostics;
}

/** One (category, tax-slice) group's reconciliation — see
 *  `reconcileIndividualToAggregate`'s docblock for the full contract. */
function reconcileGroup(
  accts: IndividualAccountInput[],
  indKey: IndKeyFn,
  indBal: Map<string, number>,
  target: number,
  label: string,
  diagnostics: string[],
): void {
  if (accts.length === 0) return;
  const sumInd = accts.reduce(
    (s, ia) => s + Math.max(0, indBal.get(indKey(ia)) ?? 0),
    0,
  );
  const delta = roundToCents(target - sumInd);
  if (delta === 0) return;

  if (Math.abs(delta) > 1) {
    diagnostics.push(
      `[DIAG] indBal/acctBal reconciliation: ${label} drifted by $${delta.toFixed(2)} (indBal sum $${sumInd.toFixed(2)} vs acctBal $${target.toFixed(2)})`,
    );
  }

  if (sumInd <= 0) {
    // No weight to distribute by — inventing one would be a second
    // allocation policy. Leave indBal alone; the diagnostic above (for
    // >$1 drift) already surfaces this if it's material.
    if (target > 0 && Math.abs(delta) <= 1) {
      diagnostics.push(
        `[DIAG] indBal/acctBal reconciliation: ${label} has $${target.toFixed(2)} in acctBal but no individual-account balance to distribute it across — left unreconciled`,
      );
    }
    return;
  }

  let distributed = 0;
  let largestKey: string | null = null;
  let largestBal = -Infinity;
  for (const ia of accts) {
    const k = indKey(ia);
    const bal = Math.max(0, indBal.get(k) ?? 0);
    if (bal > largestBal) {
      largestBal = bal;
      largestKey = k;
    }
    const share = roundToCents(delta * (bal / sumInd));
    const newBal = Math.max(0, roundToCents(bal + share));
    indBal.set(k, newBal);
    distributed += roundToCents(newBal - bal);
  }
  const residual = roundToCents(delta - distributed);
  if (residual !== 0 && largestKey) {
    const bal = Math.max(0, indBal.get(largestKey) ?? 0);
    indBal.set(largestKey, Math.max(0, roundToCents(bal + residual)));
  }
}

/**
 * Clamps tracked Roth basis to each account's (already-clamped) balance —
 * market losses, or a dust-cleaned zero balance, can otherwise leave
 * tracked basis exceeding what the account actually holds. Mirrors
 * `early-access.ts`'s own balance clamp (see `clampBasisToBalance`'s
 * docblock). Call AFTER balance clamping/dust cleanup, so it reads the
 * final balance for the year. Mutates `indBasis` in place.
 */
export function clampIndividualBasis(
  indAccts: IndividualAccountInput[],
  indKey: IndKeyFn,
  indBasis: Map<string, RothBasisState>,
  indBal: Map<string, number>,
): void {
  for (const ia of indAccts) {
    const k = indKey(ia);
    const state = indBasis.get(k);
    if (!state) continue;
    const balance = Math.max(0, indBal.get(k) ?? 0);
    indBasis.set(k, clampBasisToBalance(state, balance));
  }
}
