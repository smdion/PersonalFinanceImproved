/** A working year's contributions, employer match, overflow and ramp,
 *  spread from the year's slots to the individual accounts. */
import type { ContributionSpec } from "../types/contribution-spec";
import type { AccumulationSlot } from "../types/routing";
import type { AccountCategory } from "../../../config/account-types";
import type { IndividualAccountInput } from "../../accounts/account-balances.types";
import { roundToCents, sumBy } from "../../../utils/math";
import {
  getAccountTypeConfig,
  isOverflowTarget,
  getAllCategories,
  isRetirementMoney,
} from "../../../config/account-types";
import { projectSpecAmount, yearZeroCut } from "../contribution-projection";
import { taxTypeOnSide } from "../../../config/tax-treatment-buckets";
import type { IndKeyFn } from "@/lib/pure/accounts/account-part";
import { rampBrokerages } from "@/lib/pure/accounts/brokerage-ramp";
import { retirementFirst, specKeyOf } from "./ledger";
import { otherParts } from "./other-tax-part";
import { creditWhole, equalShares, inflowShares } from "./part-weights";
import { placeWhole } from "@/lib/pure/accounts/place-whole";
import { creditSpecParts, onSpecParts, type SpecParts } from "./spec-accounts";
import { unclaimedRest, unclaimedSlot } from "./own-part-credits";

interface DistributeContributionsInput {
  slots: AccumulationSlot[];
  contributionSpecs: ContributionSpec[];
  indAccounts: IndividualAccountInput[];
  indKey: IndKeyFn;
  indBalance: Map<string, number>;
  indParentCat: Map<string, string>;
  specToAccount: Map<string, SpecParts>;
  accountsWithSpecs: Set<string>;
  projectedSalary: number;
  currentSalary: number;
  personPay?: {
    projected: ReadonlyMap<number, number>;
    base: Readonly<Record<number, number>>;
  };
  limitGrowthRate: number;
  yearIndex: number;
  proRate: number;
  useRealContributions: boolean;
  overflowToBrokerage: number;
  rampAmount: number;
  employerMatchByParentCat?: Map<AccountCategory, Map<string, number>>;
}

interface DistributeContributionsResult {
  indContributions: Map<string, number>;
  indMatch: Map<string, number>;
  indIntentional: Map<string, number>;
  indOverflow: Map<string, number>;
  indRamp: Map<string, number>;
}

/**
 * Distribute slot-level contributions to individual accounts using spec weights.
 * Also handles employer match, overflow, intentional tracking, and ramp distribution.
 * Mutates `indBalance` in place.
 */
export function distributeContributions(
  input: DistributeContributionsInput,
): DistributeContributionsResult {
  const {
    slots,
    contributionSpecs,
    indAccounts,
    indKey,
    indBalance,
    indParentCat,
    specToAccount,
    accountsWithSpecs,
    projectedSalary,
    currentSalary,
    personPay,
    limitGrowthRate,
    yearIndex: y,
    proRate,
    rampAmount,
    employerMatchByParentCat,
  } = input;
  // The year's overflow rides in its slot: the parts take no more than it holds.
  const overflowToBrokerage = Math.min(
    input.overflowToBrokerage,
    sumBy(slots, (s) => (isOverflowTarget(s.category) ? s.employeeContrib : 0)),
  );
  const ledger = { ...input, overflowToBrokerage };

  const indContributions = new Map<string, number>();
  const indMatch = new Map<string, number>();
  const indIntentional = new Map<string, number>();
  const indOverflow = new Map<string, number>();
  const indRamp = new Map<string, number>();

  // --- Step 1: Compute raw projected amount per spec (for weighting only) ---
  const lgf = Math.pow(1 + limitGrowthRate, y);
  const specRaw = new Map<string, number>();
  const specAccount = new Map<string, SpecParts>();
  for (const spec of contributionSpecs) {
    const sk = specKeyOf(spec);
    const accountName = specToAccount.get(sk);
    if (!accountName) continue;
    // Year 0 from the paycheck: the slot's own basis, each spec's money left.
    const projected = roundToCents(
      Math.max(
        0,
        y === 0 && input.useRealContributions
          ? spec.baseAnnual * proRate - yearZeroCut(spec, proRate)
          : projectSpecAmount(spec, {
              projectedSalary,
              salaryBase: currentSalary,
              limitGrowthFactor: lgf,
              personPay,
              proRate,
            }) - (y === 0 ? yearZeroCut(spec, proRate) : 0),
      ),
    );
    specRaw.set(sk, projected);
    specAccount.set(sk, accountName);
  }

  // --- Step 2: Distribute slot totals to individual accounts using spec weights ---
  // Fixed-amount specs first (capped at the slot), the rest by scaling specs' weights, else unclaimedRest.
  const toOtherPart = otherParts(input, specAccount, specRaw, indContributions);
  for (const slot of slots) {
    const bs = getAccountTypeConfig(slot.category).balanceStructure;
    const catSpecs = contributionSpecs.filter(
      (s) => s.category === slot.category,
    );

    const distributeSpecs = (allSpecs: typeof catSpecs, slotAmount: number) => {
      // Portfolio-parented specs get their own amount first: the retirement
      // rate ceiling never scales them, so a scaled-down slot comes out of
      // the retirement specs only.
      let remaining = slotAmount;
      for (const sp of allSpecs) {
        if (isRetirementMoney(sp.parentCategory)) continue;
        const sk = specKeyOf(sp);
        const parts = specAccount.get(sk);
        if (!parts) continue;
        const portion = roundToCents(Math.min(specRaw.get(sk) ?? 0, remaining));
        if (portion <= 0) continue;
        creditSpecParts(input, parts, portion, [indContributions, indBalance]);
        remaining -= portion;
      }
      const specs = allSpecs.filter((sp) =>
        isRetirementMoney(sp.parentCategory),
      );
      const fixedSpecs = specs.filter(
        (s) => s.contributionScaling === "fixed_amount",
      );
      const scalingSpecs = specs.filter(
        (s) => s.contributionScaling !== "fixed_amount",
      );

      for (const sp of fixedSpecs) {
        const sk = specKeyOf(sp);
        const parts = specAccount.get(sk);
        if (!parts) continue;
        const rawAmount = specRaw.get(sk) ?? 0;
        const portion = roundToCents(Math.min(rawAmount, remaining));
        if (portion <= 0) continue;
        creditSpecParts(input, parts, portion, [indContributions, indBalance]);
        remaining -= portion;
      }

      if (scalingSpecs.length === 0)
        unclaimedRest(ledger, slot, allSpecs, remaining, indContributions);
      else if (remaining > 0) {
        const keys = scalingSpecs.map(specKeyOf);
        const rawTotal = sumBy(keys, (sk) => specRaw.get(sk) ?? 0);
        const paid = keys.filter((sk) => specAccount.has(sk));
        const weight = (sk: string) =>
          rawTotal > 0
            ? (specRaw.get(sk) ?? 0) / rawTotal
            : 1 / scalingSpecs.length;
        const raw = paid.map((sk) => remaining * weight(sk));
        placeWhole(roundToCents(sumBy(raw, (r) => r)), raw).forEach(
          (portion, i) =>
            creditSpecParts(input, specAccount.get(paid[i]!)!, portion, [
              indContributions,
              indBalance,
            ]),
        );
      }
    };

    if (catSpecs.length === 0) unclaimedSlot(ledger, slot, indContributions);
    else if (bs === "roth_traditional") {
      for (const [taxTreatment, slotAmount] of [
        ["pre_tax", slot.traditionalContrib],
        ["tax_free", slot.rothContrib],
      ] as const) {
        const typeSpecs = catSpecs.filter(
          (s) => s.taxTreatment === taxTreatment,
        );
        if (typeSpecs.length > 0) distributeSpecs(typeSpecs, slotAmount);
        else toOtherPart(catSpecs, taxTreatment, slotAmount);
      }
    } else {
      // The overflow target's slot also carries the overflow Step 4 routes: the specs take the rest.
      distributeSpecs(
        catSpecs,
        isOverflowTarget(slot.category)
          ? roundToCents(slot.employeeContrib - overflowToBrokerage)
          : slot.employeeContrib,
      );
    }
  }

  // --- Step 3: Route employer match to individual accounts ---
  // A pool's match: its parts of the totals' match tax type, those with specs first, by balance.
  const spreadMatch = (pool: IndividualAccountInput[], amount: number) => {
    const candidates = pool.filter(
      (ia) => ia.taxType === taxTypeOnSide(ia.category, "traditional"),
    );
    const withSpecs = candidates.filter((ia) =>
      accountsWithSpecs.has(indKey(ia)),
    );
    const accounts = withSpecs.length > 0 ? withSpecs : candidates;
    const shares = inflowShares(
      accounts.map((ia) => indBalance.get(indKey(ia)) ?? 0),
      equalShares(accounts.length),
    );
    const raw = shares.map((s) => amount * s);
    creditWhole(accounts.map(indKey), amount, raw, [indMatch, indBalance]);
  };
  for (const cat of getAllCategories()) {
    const catMatch = slots.find((s) => s.category === cat)?.employerMatch ?? 0;
    if (catMatch <= 0) continue;
    const parentCatMatchData = employerMatchByParentCat?.get(cat);
    const catAccounts = indAccounts.filter((ia) => ia.category === cat);
    if (parentCatMatchData && parentCatMatchData.size > 0) {
      const byParent = [...parentCatMatchData];
      const totalMatch = byParent.reduce((s, [, v]) => s + v, 0);
      const placed = placeWhole(
        catMatch,
        byParent.map(([, baseMatch]) => catMatch * (baseMatch / totalMatch)),
      );
      byParent.forEach(([pCat], i) =>
        spreadMatch(
          catAccounts.filter((ia) => indParentCat.get(indKey(ia)) === pCat),
          placed[i]!,
        ),
      );
    } else {
      spreadMatch(catAccounts, catMatch);
    }
  }

  // --- Step 4: Distribute overflow to brokerage accounts by allocationPriority ---
  if (overflowToBrokerage > 0) {
    // Overflow is retirement money: Retirement-parented brokerage accounts first (specs only
    // order and cap within them), including the projection-only retirement brokerage, so
    // overflow never becomes Portfolio money.
    const brokAccounts = retirementFirst(
      indAccounts.filter((ia) => isOverflowTarget(ia.category)),
      (ia) => indParentCat.get(indKey(ia)) ?? ia.parentCategory,
    );
    const brokKeys = new Set(brokAccounts.map((ia) => indKey(ia)));
    const overflowSpecs = contributionSpecs
      .filter(
        (s) =>
          isOverflowTarget(s.category) &&
          specToAccount.get(specKeyOf(s))?.some((k) => brokKeys.has(k)),
      )
      .sort((a, b) => a.allocationPriority - b.allocationPriority);

    let remaining = overflowToBrokerage;
    for (const spec of overflowSpecs) {
      if (remaining <= 0) break;
      if (spec.targetAnnual == null || spec.targetAnnual <= 0) continue;
      const sk = specKeyOf(spec);
      const accountName = specToAccount.get(sk);
      if (!accountName) continue;
      const currentContribution = onSpecParts(indContributions, accountName);
      const room = Math.max(0, spec.targetAnnual - currentContribution);
      const portion = roundToCents(Math.min(remaining, room));
      if (portion > 0) {
        creditSpecParts(input, accountName, portion, [
          indContributions,
          indBalance,
          indOverflow,
        ]);
        remaining -= portion;
      }
    }
    if (remaining > 0) {
      const noTargetSpecs = overflowSpecs.filter((s) => s.targetAnnual == null);
      if (noTargetSpecs.length > 0) {
        const to = noTargetSpecs.map((s) => specToAccount.get(specKeyOf(s))!);
        const each = to.map(() => remaining / to.length);
        placeWhole(roundToCents(remaining), each).forEach((portion, i) =>
          creditSpecParts(input, to[i]!, portion, [
            indContributions,
            indBalance,
            indOverflow,
          ]),
        );
        // Routed in full — the fallback below must not hand it out again.
        remaining = 0;
      } else {
        const lastSpec = overflowSpecs[overflowSpecs.length - 1];
        if (lastSpec) {
          const accountName = specToAccount.get(specKeyOf(lastSpec));
          if (accountName) {
            creditSpecParts(input, accountName, remaining, [
              indContributions,
              indBalance,
              indOverflow,
            ]);
            remaining = 0;
          }
        }
      }
    }

    // Fallback: if remaining overflow wasn't routed (no matching specs),
    // distribute to joint/unowned brokerage accounts directly.
    if (remaining > 0) {
      const jointBrok = brokAccounts.filter((ia) => ia.ownerPersonId == null);
      const fallback = jointBrok.length > 0 ? jointBrok : brokAccounts;
      const keys = fallback.map(indKey);
      const each = keys.map(() => remaining / keys.length);
      creditWhole(keys, roundToCents(remaining), each, [
        indContributions,
        indBalance,
        indOverflow,
      ]);
    }
  }

  // --- Step 5: Track intentional contributions for source breakdown ---
  for (const spec of contributionSpecs) {
    if (!isOverflowTarget(spec.category)) continue;
    const sk = specKeyOf(spec);
    const accountName = specAccount.get(sk);
    if (!accountName) continue;
    creditSpecParts(input, accountName, specRaw.get(sk)!, [indIntentional]);
  }

  // --- Step 6: Distribute ramp to brokerage accounts ---
  if (rampAmount > 0) {
    // The ramp is Portfolio savings: Portfolio brokerages when there are any, then those with
    // specs of their own. The projection-only retirement brokerage takes it only when the
    // household has no brokerage at all.
    const parentOf = (ia: IndividualAccountInput) =>
      indParentCat.get(indKey(ia)) ?? ia.parentCategory;
    const group = rampBrokerages(indAccounts, parentOf);
    const groupWithSpecs = group.filter((ia) =>
      accountsWithSpecs.has(indKey(ia)),
    );
    const brokAccounts = groupWithSpecs.length > 0 ? groupWithSpecs : group;
    const shares = inflowShares(
      brokAccounts.map((ia) => indBalance.get(indKey(ia)) ?? 0),
      equalShares(brokAccounts.length),
    );
    const raw = shares.map((s) => rampAmount * s);
    creditWhole(brokAccounts.map(indKey), rampAmount, raw, [
      indContributions,
      indBalance,
      indRamp,
    ]);
  }

  return { indContributions, indMatch, indIntentional, indOverflow, indRamp };
}
