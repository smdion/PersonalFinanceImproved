/** A working year's contributions, employer match, overflow and ramp,
 *  spread from the year's slots to the individual accounts. */
import type { ContributionSpec } from "../types/contribution-spec";
import type { AccumulationSlot } from "../types/routing";
import type { AccountCategory } from "../../../config/account-types";
import type { IndividualAccountInput } from "../../accounts/account-balances.types";
import { roundToCents } from "../../../utils/math";
import {
  getAccountTypeConfig,
  isOverflowTarget,
  getAllCategories,
  isPreTaxType,
  isRetirementMoney,
} from "../../../config/account-types";
import { TAX_TREATMENT_TO_TAX_TYPE } from "../../../config/tax-treatment-buckets";
import { projectSpecAmount } from "../contribution-projection";
import type { IndKeyFn } from "@/lib/pure/accounts/account-part";
import { credit, portfolioFirst, retirementFirst, specKeyOf } from "./ledger";

/**
 * Build mapping from contribution spec keys to individual account keys.
 * Match on structured fields: category + ownerName + taxType (no fuzzy logic).
 */
export function buildSpecToAccountMapping(
  contributionSpecs: ContributionSpec[],
  indAccounts: IndividualAccountInput[],
  indKey: IndKeyFn,
  indParentCat: Map<string, string>,
): { specToAccount: Map<string, string>; accountsWithSpecs: Set<string> } {
  const specToAccount = new Map<string, string>();
  // The projection-only retirement brokerage has no contributions of its own.
  const accounts = indAccounts.filter((ia) => !ia.projectedOnly);

  for (const spec of contributionSpecs) {
    const specTaxType = TAX_TREATMENT_TO_TAX_TYPE[spec.taxTreatment];
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
    const unowned = (ia: { ownerPersonId?: number; ownerName?: string }) =>
      ia.ownerPersonId === undefined && ia.ownerName === undefined;
    const ownerMatch = (ia: { ownerPersonId?: number; ownerName?: string }) =>
      exactOwner(ia) || unowned(ia);

    // The match rules, tried in rank order: the first that finds an account
    // in the spec's category wins.
    const matchRules: ((ia: IndividualAccountInput) => boolean)[] = [
      (ia) =>
        exactOwner(ia) && ia.taxType === specTaxType && parentCatMatch(ia),
      (ia) => unowned(ia) && ia.taxType === specTaxType && parentCatMatch(ia),
      (ia) => exactOwner(ia) && parentCatMatch(ia),
      (ia) => unowned(ia) && parentCatMatch(ia),
      ownerMatch,
    ];
    let match: IndividualAccountInput | undefined;
    for (const rule of matchRules) {
      match = accounts.find((ia) => ia.category === spec.category && rule(ia));
      if (match) break;
    }
    if (match) specToAccount.set(specKeyOf(spec), indKey(match));
  }

  return { specToAccount, accountsWithSpecs: new Set(specToAccount.values()) };
}

interface DistributeContributionsInput {
  slots: AccumulationSlot[];
  contributionSpecs: ContributionSpec[];
  indAccounts: IndividualAccountInput[];
  indKey: IndKeyFn;
  indBalance: Map<string, number>;
  indParentCat: Map<string, string>;
  specToAccount: Map<string, string>;
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
 *
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
    overflowToBrokerage,
    rampAmount,
    employerMatchByParentCat,
  } = input;

  const indContributions = new Map<string, number>();
  const indMatch = new Map<string, number>();
  const indIntentional = new Map<string, number>();
  const indOverflow = new Map<string, number>();
  const indRamp = new Map<string, number>();

  const ACCOUNT_CATEGORIES: AccountCategory[] = getAllCategories();

  // --- Step 1: Compute raw projected amount per spec (for weighting only) ---
  const lgf = Math.pow(1 + limitGrowthRate, y);
  const specRaw = new Map<string, number>();
  const specAccount = new Map<string, string>();
  for (const spec of contributionSpecs) {
    const sk = specKeyOf(spec);
    const accountName = specToAccount.get(sk);
    if (!accountName) continue;
    const projected = roundToCents(
      projectSpecAmount(spec, {
        projectedSalary,
        salaryBase: currentSalary,
        limitGrowthFactor: lgf,
        personPay,
        proRate,
      }),
    );
    specRaw.set(sk, projected);
    specAccount.set(sk, accountName);
  }

  // --- Step 2: Distribute slot totals to individual accounts using spec weights ---
  // Fixed-amount specs are pre-allocated directly; remaining slot total is distributed
  // proportionally among scales-with-salary specs.
  for (const slot of slots) {
    const bs = getAccountTypeConfig(slot.category).balanceStructure;
    const catSpecs = contributionSpecs.filter(
      (s) => s.category === slot.category,
    );

    const distributeSpecs = (allSpecs: typeof catSpecs, slotAmount: number) => {
      // Portfolio-parented specs get their own amount first: the retirement
      // rate ceiling never scales them (AccumulationSlot.portfolioContrib),
      // so a scaled-down slot comes out of the retirement specs only.
      // Unscaled, every spec gets its raw amount either way.
      let remaining = slotAmount;
      for (const sp of allSpecs) {
        if (isRetirementMoney(sp.parentCategory)) continue;
        const sk = specKeyOf(sp);
        const accountName = specAccount.get(sk);
        if (!accountName) continue;
        const portion = roundToCents(Math.min(specRaw.get(sk) ?? 0, remaining));
        if (portion <= 0) continue;
        credit(accountName, portion, [indContributions, indBalance]);
        remaining -= portion;
      }
      const specs = allSpecs.filter((sp) =>
        isRetirementMoney(sp.parentCategory),
      );
      // Separate fixed-amount specs from scaling specs
      const fixedSpecs = specs.filter(
        (s) => s.contributionScaling === "fixed_amount",
      );
      const scalingSpecs = specs.filter(
        (s) => s.contributionScaling !== "fixed_amount",
      );

      // Pre-allocate fixed specs their raw amount (capped at slot total)
      for (const sp of fixedSpecs) {
        const sk = specKeyOf(sp);
        const accountName = specAccount.get(sk);
        if (!accountName) continue;
        const rawAmount = specRaw.get(sk) ?? 0;
        const portion = roundToCents(Math.min(rawAmount, remaining));
        if (portion <= 0) continue;
        credit(accountName, portion, [indContributions, indBalance]);
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
          const accountName = specAccount.get(sk);
          if (!accountName) continue;
          const weight =
            rawTotal > 0
              ? (specRaw.get(sk) ?? 0) / rawTotal
              : 1 / scalingSpecs.length;
          const portion = roundToCents(remaining * weight);
          credit(accountName, portion, [indContributions, indBalance]);
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
      // The overflow target's slot also carries this year's IRS overflow
      // (routeFromSpecs adds it there); Step 4 routes that part, so only the
      // specs' own contributions are spread here — distributing the whole
      // slot counted the overflow twice.
      distributeSpecs(
        catSpecs,
        isOverflowTarget(slot.category)
          ? Math.max(
              0,
              roundToCents(slot.employeeContrib - overflowToBrokerage),
            )
          : slot.employeeContrib,
      );
    }
  }

  // --- Step 3: Route employer match to individual accounts ---
  // A pool's match goes to its pre-tax accounts (all of them when it has
  // none), those with specs of their own first, weighted by balance.
  const spreadMatch = (pool: IndividualAccountInput[], amount: number) => {
    const preTax = pool.filter((ia) => isPreTaxType(ia.taxType));
    const candidates = preTax.length > 0 ? preTax : pool;
    const withSpecs = candidates.filter((ia) =>
      accountsWithSpecs.has(indKey(ia)),
    );
    const accounts = withSpecs.length > 0 ? withSpecs : candidates;
    const total = accounts.reduce(
      (s, ia) => s + (indBalance.get(indKey(ia)) ?? 0),
      0,
    );
    for (const ia of accounts) {
      const k = indKey(ia);
      const weight =
        total > 0 ? (indBalance.get(k) ?? 0) / total : 1 / accounts.length;
      credit(k, roundToCents(amount * weight), [indMatch, indBalance]);
    }
  };
  for (const cat of ACCOUNT_CATEGORIES) {
    const catMatch = slots.find((s) => s.category === cat)?.employerMatch ?? 0;
    if (catMatch <= 0) continue;
    const parentCatMatchData = employerMatchByParentCat?.get(cat);
    const catAccounts = indAccounts.filter(
      (ia) => ia.category === cat && !ia.projectedOnly,
    );
    if (parentCatMatchData && parentCatMatchData.size > 0) {
      let totalMatch = 0;
      parentCatMatchData.forEach((v) => {
        totalMatch += v;
      });
      parentCatMatchData.forEach((baseMatch, pCat) => {
        const scaledMatch = roundToCents(catMatch * (baseMatch / totalMatch));
        spreadMatch(
          catAccounts.filter((ia) => indParentCat.get(indKey(ia)) === pCat),
          scaledMatch,
        );
      });
    } else {
      spreadMatch(catAccounts, catMatch);
    }
  }

  // --- Step 4: Distribute overflow to brokerage accounts by allocationPriority ---
  if (overflowToBrokerage > 0) {
    // Overflow is retirement money (contributions past the IRS limits):
    // Retirement-parented brokerage specs/accounts first.
    // The accounts decide (a Retirement brokerage with no spec of its own
    // still takes overflow before any Portfolio one); specs only order and
    // cap it within those accounts. The projection-only retirement
    // brokerage counts: with no real Retirement brokerage it's where
    // retirement money lands, so overflow never becomes Portfolio money.
    const brokAccounts = retirementFirst(
      indAccounts.filter((ia) => isOverflowTarget(ia.category)),
      (ia) => indParentCat.get(indKey(ia)) ?? ia.parentCategory,
    );
    const brokKeys = new Set(brokAccounts.map((ia) => indKey(ia)));
    const overflowSpecs = contributionSpecs
      .filter(
        (s) =>
          isOverflowTarget(s.category) &&
          brokKeys.has(specToAccount.get(specKeyOf(s)) ?? ""),
      )
      .sort(
        (a, b) => (a.allocationPriority ?? 0) - (b.allocationPriority ?? 0),
      );

    if (brokAccounts.length > 0) {
      let remaining = overflowToBrokerage;
      for (const spec of overflowSpecs) {
        if (remaining <= 0) break;
        if (spec.targetAnnual == null || spec.targetAnnual <= 0) continue;
        const sk = specKeyOf(spec);
        const accountName = specToAccount.get(sk);
        if (!accountName) continue;
        const currentContribution = indContributions.get(accountName) ?? 0;
        const room = Math.max(0, spec.targetAnnual - currentContribution);
        const portion = roundToCents(Math.min(remaining, room));
        if (portion > 0) {
          credit(accountName, portion, [
            indContributions,
            indBalance,
            indOverflow,
          ]);
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
            const accountName = specToAccount.get(specKeyOf(spec));
            if (!accountName) continue;
            credit(accountName, perAccount, [
              indContributions,
              indBalance,
              indOverflow,
            ]);
          }
          // Routed in full — the fallback below must not hand it out again.
          remaining = 0;
        } else {
          const lastSpec = overflowSpecs[overflowSpecs.length - 1];
          if (lastSpec) {
            const accountName = specToAccount.get(specKeyOf(lastSpec));
            if (accountName) {
              credit(accountName, remaining, [
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
        const fallbackAccounts =
          jointBrok.length > 0 ? jointBrok : brokAccounts;
        const perAccount = roundToCents(remaining / fallbackAccounts.length);
        for (const ia of fallbackAccounts) {
          const k = indKey(ia);
          credit(k, perAccount, [indContributions, indBalance, indOverflow]);
        }
      }
    }
  }

  // --- Step 5: Track intentional contributions for source breakdown ---
  for (const spec of contributionSpecs) {
    if (!isOverflowTarget(spec.category)) continue;
    const accountName = specToAccount.get(specKeyOf(spec));
    if (!accountName) continue;
    const projected = roundToCents(
      projectSpecAmount(spec, {
        projectedSalary,
        salaryBase: currentSalary,
        limitGrowthFactor: lgf,
        personPay,
        proRate,
      }),
    );
    indIntentional.set(
      accountName,
      (indIntentional.get(accountName) ?? 0) + projected,
    );
  }

  // --- Step 6: Distribute ramp to brokerage accounts ---
  if (rampAmount > 0) {
    // The ramp (the Brokerage page's yearly increase) is Portfolio
    // savings: the parent is chosen first (Portfolio brokerages when there
    // are any), then within it the brokerages with specs of their own. The
    // projection-only retirement brokerage takes it only when the household
    // has no brokerage at all.
    const parentOf = (ia: IndividualAccountInput) =>
      indParentCat.get(indKey(ia)) ?? ia.parentCategory;
    const brokerages = indAccounts.filter((ia) =>
      isOverflowTarget(ia.category),
    );
    const real = brokerages.filter((ia) => !ia.projectedOnly);
    const group = real.length > 0 ? portfolioFirst(real, parentOf) : brokerages;
    const groupWithSpecs = group.filter((ia) =>
      accountsWithSpecs.has(indKey(ia)),
    );
    const brokAccounts = groupWithSpecs.length > 0 ? groupWithSpecs : group;
    const brokTotal = brokAccounts.reduce(
      (s, ia) => s + (indBalance.get(indKey(ia)) ?? 0),
      0,
    );
    for (const ia of brokAccounts) {
      const k = indKey(ia);
      const weight =
        brokTotal > 0
          ? (indBalance.get(k) ?? 0) / brokTotal
          : 1 / brokAccounts.length;
      const portion = roundToCents(rampAmount * weight);
      credit(k, portion, [indContributions, indBalance, indRamp]);
    }
  }

  return { indContributions, indMatch, indIntentional, indOverflow, indRamp };
}
