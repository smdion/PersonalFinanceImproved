/**
 * Pure portfolio-snapshot → tax-bucket aggregation.
 *
 * Extracted from `src/server/retirement/build-engine-payload.ts` so the
 * Retirement engine and the Tax Buckets analysis tool share one
 * implementation of "what do we actually hold, by tax bucket" instead of
 * two that can silently drift apart (RULES.md § Pure Business Logic
 * Boundary / no second computation path).
 */
import type {
  TaxBuckets,
  AccountBalances,
  AccountCategory,
} from "@/lib/calculators/types";
import {
  getAllCategories,
  zeroBalance,
  addTraditional,
  addRoth,
  addBalance,
  addBasis,
  isTaxFreeBucket,
  tracksCostBasis,
  isRetirementParent,
  PARENT_CATEGORY_VALUES,
} from "@/lib/config/account-types";
import { accountDisplayName } from "@/lib/utils/format";
import { toNumber } from "@/server/helpers/transforms";
import { roundToCents, sumBy, safeDivide } from "@/lib/utils/math";

/** parentCategory values the projection engine includes in starting balances. */
const ENGINE_CATEGORIES = new Set<string>(PARENT_CATEGORY_VALUES);

export type TaxBucketSnapshotAccount = {
  institution: string;
  taxType: string;
  accountType: AccountCategory;
  subType: string | null;
  label: string | null;
  parentCategory: string | null;
  amount: number;
  ownerPersonId: number | null;
  performanceAccountId: number | null;
  displayName: string | null;
  accountLabel: string | null;
};

export type TaxBucketPerfAccount = {
  isActive: boolean;
  accountType: string;
  costBasis: string | null;
};

/** Per-(name, category, taxType, owner) rollup — the join key the Tax
 *  Buckets tool needs to attach `rothBasis` rows and early-access flags to
 *  real balances without re-querying `portfolio_accounts` itself.
 *
 *  Grouped on the SAME tuple as `accountBreakdownByCategory` (and, via that,
 *  the engine's own `individualAccounts` keying) rather than on
 *  `performanceAccountId` alone — a raw-ID key merges/splits sub-type rows
 *  (Rollover, Employer Match, ...) differently than the name-based grouping
 *  the engine payload uses, which can silently drop or double-count a
 *  projected balance when the two sides are joined by name in v2. */
export type AccountRollupEntry = {
  name: string;
  /** Null only when a merged group of same-(name,category,taxType,owner)
   *  rows spans more than one real performance account — rare, since that
   *  requires two distinct accounts to also share a display name. Per-
   *  account edit actions (basis, separation date) key off
   *  `performanceAccounts` directly, not off this rollup, so ambiguity
   *  here doesn't block those. */
  performanceAccountId: number | null;
  ownerPersonId: number | null;
  taxType: string;
  category: string;
  amount: number;
};

export type AccountBreakdownEntry = {
  name: string;
  amount: number;
  taxType: string;
  ownerName?: string;
  ownerPersonId?: number;
  accountType?: string;
  parentCategory?: string;
};

export type TaxBucketBreakdown = {
  portfolioByTaxType: TaxBuckets;
  portfolioByTaxTypeByParentCat: Record<string, TaxBuckets>;
  portfolioByAccount: AccountBalances;
  portfolioTotal: number;
  accountOwnersByCategory: Record<string, string>;
  ownershipByPerson: Record<string, Record<string, number>>;
  accountBreakdownByCategory: Record<string, AccountBreakdownEntry[]>;
  accountRollup: AccountRollupEntry[];
};

/**
 * Aggregate a portfolio snapshot into tax buckets, per-account balances, and
 * per-person ownership fractions. `perfAccounts` supplies cost basis for the
 * after-tax (brokerage) bucket — filtered `isActive` same as the household
 * sum this mirrors.
 */
export function computeTaxBucketBreakdown(
  snapshotData: { accounts: TaxBucketSnapshotAccount[] } | null,
  people: { id: number; name: string }[],
  perfAccounts: TaxBucketPerfAccount[],
): TaxBucketBreakdown {
  const portfolioByTaxType: TaxBuckets = {
    preTax: 0,
    taxFree: 0,
    hsa: 0,
    afterTax: 0,
    afterTaxBasis: 0,
  };
  const portfolioByTaxTypeByParentCat: Record<string, TaxBuckets> = {};
  const portfolioByAccount: AccountBalances = Object.fromEntries(
    getAllCategories().map((cat) => [cat, zeroBalance(cat)]),
  ) as AccountBalances;
  const personNameById = new Map(people.map((p) => [p.id, p.name]));
  const accountOwnerSets: Record<string, Set<string>> = {};
  const balanceByPersonByCategory: Record<string, Record<string, number>> = {};
  const accountBreakdownByCategory: Record<string, AccountBreakdownEntry[]> =
    {};
  const rollupByKey = new Map<string, AccountRollupEntry>();

  if (snapshotData) {
    // Sub-type rows (Rollover, Employer Match, etc.) inherit their parent
    // performance account's primary accountType.
    const parentTypeByPerfId = new Map<number, string>();
    for (const a of snapshotData.accounts) {
      if (a.performanceAccountId != null && !a.subType) {
        parentTypeByPerfId.set(a.performanceAccountId, a.accountType);
      }
    }

    for (const a of snapshotData.accounts) {
      // Only engine-relevant categories (Retirement + Portfolio) — pages
      // filter engine output by parentCategory for the correct subset.
      if (a.parentCategory && !ENGINE_CATEGORIES.has(a.parentCategory))
        continue;
      const ownerName = a.ownerPersonId
        ? personNameById.get(a.ownerPersonId)
        : undefined;
      const displayName = accountDisplayName(a, ownerName);
      const cat =
        a.subType && a.performanceAccountId != null
          ? (parentTypeByPerfId.get(a.performanceAccountId) ?? a.accountType)
          : a.accountType;
      const key = a.taxType as "preTax" | "taxFree" | "hsa" | "afterTax";
      portfolioByTaxType[key] += a.amount;

      const pCat = a.parentCategory ?? "Retirement";
      if (!portfolioByTaxTypeByParentCat[pCat]) {
        portfolioByTaxTypeByParentCat[pCat] = {
          preTax: 0,
          taxFree: 0,
          hsa: 0,
          afterTax: 0,
          afterTaxBasis: 0,
        };
      }
      portfolioByTaxTypeByParentCat[pCat][key] += a.amount;

      const catAsBal = cat as AccountCategory;
      const bal = portfolioByAccount[catAsBal];
      if (bal.structure === "roth_traditional") {
        if (isTaxFreeBucket(a.taxType)) addRoth(bal, a.amount);
        else addTraditional(bal, a.amount);
      } else {
        addBalance(bal, a.amount);
      }

      if (ownerName) {
        if (!accountOwnerSets[cat]) accountOwnerSets[cat] = new Set();
        accountOwnerSets[cat].add(ownerName);
        if (!balanceByPersonByCategory[ownerName])
          balanceByPersonByCategory[ownerName] = {};
        balanceByPersonByCategory[ownerName][cat] =
          (balanceByPersonByCategory[ownerName][cat] ?? 0) + a.amount;
      } else {
        // Joint account — attribute to all people equally for ownership fractions
        if (!accountOwnerSets[cat]) accountOwnerSets[cat] = new Set();
        accountOwnerSets[cat].add("Joint");
        for (const pName of Array.from(personNameById.values())) {
          if (!balanceByPersonByCategory[pName])
            balanceByPersonByCategory[pName] = {};
          balanceByPersonByCategory[pName][cat] =
            (balanceByPersonByCategory[pName][cat] ?? 0) +
            a.amount / personNameById.size;
        }
      }

      if (!accountBreakdownByCategory[cat])
        accountBreakdownByCategory[cat] = [];
      // Owner included in the merge key (v0.7.8 Group 1 prerequisite,
      // advisor finding S3): two different people's accounts sharing a
      // display name within the same category/taxType must stay separate
      // rows — merging them silently kept only the first owner's
      // ownerPersonId, which downstream per-owner eligibility gating
      // (Rule of 55, 59½, etc.) needs to be correct.
      const existing = accountBreakdownByCategory[cat].find(
        (e) =>
          e.name === displayName &&
          e.taxType === a.taxType &&
          e.ownerPersonId === (a.ownerPersonId ?? undefined),
      );
      if (existing) {
        existing.amount += a.amount;
      } else {
        accountBreakdownByCategory[cat].push({
          name: displayName,
          amount: a.amount,
          taxType: a.taxType,
          ownerName,
          ownerPersonId: a.ownerPersonId ?? undefined,
          accountType: cat,
          parentCategory: a.parentCategory ?? undefined,
        });
      }

      // Per-(name, category, taxType, owner) rollup — grouped on the exact
      // same tuple as accountBreakdownByCategory above, so the two merge
      // identically and a v2 join by name can't drop or double-count a row
      // that the breakdown split/merged differently than a raw-ID key would.
      //
      // Retirement-only: unlike accountBreakdownByCategory (which the engine
      // needs for its full net-worth projection, Portfolio category
      // included), this rollup feeds the Tax Buckets tool specifically —
      // early-access/Rule-of-55 questions don't apply to a taxable
      // Portfolio-category brokerage account (e.g. "Long Term Brokerage"),
      // only to Retirement-category holdings. Excluding it here means the
      // v2 "at retirement" join (which matches by this same tuple against
      // the engine's projected accounts) naturally excludes it too.
      if (isRetirementParent(pCat)) {
        const rollupKey = `${displayName}|${cat}|${a.taxType}|${a.ownerPersonId ?? "null"}`;
        const rollupExisting = rollupByKey.get(rollupKey);
        if (rollupExisting) {
          rollupExisting.amount += a.amount;
          if (rollupExisting.performanceAccountId !== a.performanceAccountId) {
            rollupExisting.performanceAccountId = null;
          }
        } else {
          rollupByKey.set(rollupKey, {
            name: displayName,
            performanceAccountId: a.performanceAccountId,
            ownerPersonId: a.ownerPersonId,
            taxType: a.taxType,
            category: cat,
            amount: a.amount,
          });
        }
      }
    }
  }

  const accountOwnersByCategory: Record<string, string> = {};
  for (const [cat, names] of Object.entries(accountOwnerSets)) {
    accountOwnersByCategory[cat] = Array.from(names).join(" + ");
  }
  const totalByCategory: Record<string, number> = {};
  for (const personBals of Object.values(balanceByPersonByCategory)) {
    for (const [cat, amt] of Object.entries(personBals)) {
      totalByCategory[cat] = (totalByCategory[cat] ?? 0) + amt;
    }
  }
  const portfolioTotal = sumBy(Object.values(totalByCategory), (v) => v);
  const ownershipByPerson: Record<string, Record<string, number>> = {};
  for (const [name, personBals] of Object.entries(balanceByPersonByCategory)) {
    ownershipByPerson[name] = {};
    let personTotal = 0;
    for (const [cat, amt] of Object.entries(personBals)) {
      const catTotal = totalByCategory[cat] ?? 1;
      ownershipByPerson[name][cat] = safeDivide(amt, catTotal, 0);
      personTotal += amt;
    }
    ownershipByPerson[name]._overall = safeDivide(
      personTotal,
      portfolioTotal,
      0,
    );
  }

  // Cost basis from performance_accounts (per-account, user-maintained
  // alongside portfolio updates).
  const costBasisVal = sumBy(
    perfAccounts.filter((p) => p.isActive && tracksCostBasis(p.accountType)),
    (p) => toNumber(String(p.costBasis ?? "0")),
  );
  portfolioByTaxType.afterTaxBasis = costBasisVal;
  const totalAfterTax = portfolioByTaxType.afterTax;
  for (const pCat of Object.keys(portfolioByTaxTypeByParentCat)) {
    const catBucket = portfolioByTaxTypeByParentCat[pCat]!;
    catBucket.afterTaxBasis =
      totalAfterTax > 0
        ? roundToCents(costBasisVal * (catBucket.afterTax / totalAfterTax))
        : 0;
  }
  addBasis(portfolioByAccount.brokerage, costBasisVal);

  return {
    portfolioByTaxType,
    portfolioByTaxTypeByParentCat,
    portfolioByAccount,
    portfolioTotal,
    accountOwnersByCategory,
    ownershipByPerson,
    accountBreakdownByCategory,
    accountRollup: Array.from(rollupByKey.values()),
  };
}
