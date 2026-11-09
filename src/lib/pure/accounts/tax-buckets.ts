/**
 * Portfolio snapshot → tax buckets: the one implementation the Retirement engine and the
 * Tax Buckets tool share.
 */
import type {
  TaxBuckets,
  AccountBalances,
} from "@/lib/pure/accounts/account-balances.types";
import type { AccountCategory } from "@/lib/config/account-types";
import {
  getAllCategories,
  zeroBalance,
  isTaxFreeBucket,
  tracksCostBasis,
  isRetirementParent,
  PARENT_CATEGORY_VALUES,
} from "@/lib/config/account-types";
import {
  addTraditional,
  addRoth,
  addBalance,
  addBasis,
} from "@/lib/config/account-balance";
import { accountDisplayName } from "@/lib/utils/account-name";
import type { PortfolioTaxType } from "@/lib/config/enum-values";
import { emptyTaxBucketMap } from "@/lib/config/tax-treatment-buckets";
import { toNumber } from "@/lib/utils/numbers";
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

type TaxBucketPerfAccount = {
  id: number;
  isActive: boolean;
  accountType: string;
  costBasis: string | null;
};

/** Per-(name, category, taxType, owner) rollup that lets the Tax Buckets tool attach
 *  `rothBasis` rows and early-access flags to balances. Same key as
 *  `accountBreakdownByCategory` (and the engine), not `performanceAccountId`. */
type AccountRollupEntry = {
  name: string;
  /** Null only when a merged group spans several performance accounts sharing a name;
   *  per-account edits key off `performanceAccounts`, so that doesn't block them. */
  performanceAccountId: number | null;
  ownerPersonId: number | null;
  taxType: string;
  category: string;
  amount: number;
};

type AccountBreakdownEntry = {
  name: string;
  amount: number;
  taxType: string;
  ownerName?: string;
  ownerPersonId?: number;
  accountType?: string;
  parentCategory?: string;
  /** Cost basis (brokerage-type accounts): this entry's rows' share of
   *  their performance accounts' `cost_basis`. */
  costBasis?: number;
  /** The performance accounts this entry's rows belong to. */
  performanceAccountIds?: number[];
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
 * A snapshot as tax buckets, per-account balances and per-person ownership fractions.
 * `perfAccounts` (filtered `isActive`) supplies the brokerage bucket's cost basis.
 */
export function computeTaxBucketBreakdown(
  snapshotData: { accounts: TaxBucketSnapshotAccount[] } | null,
  people: { id: number; name: string }[],
  perfAccounts: TaxBucketPerfAccount[],
): TaxBucketBreakdown {
  const portfolioByTaxType: TaxBuckets = {
    ...emptyTaxBucketMap(),
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

    // Cost basis is kept per performance account (cost_basis); each of its
    // snapshot rows (sub-type rows share the account) gets its share by
    // amount. An account with no row in the snapshot contributes nothing.
    const perfById = new Map(perfAccounts.map((p) => [p.id, p]));
    const rowsTotalByPerf = new Map<number, number>();
    for (const a of snapshotData.accounts) {
      if (a.parentCategory && !ENGINE_CATEGORIES.has(a.parentCategory))
        continue;
      if (a.performanceAccountId == null) continue;
      rowsTotalByPerf.set(
        a.performanceAccountId,
        (rowsTotalByPerf.get(a.performanceAccountId) ?? 0) + a.amount,
      );
    }
    // null = this row has no known basis (not a basis-tracking account, or
    // its basis isn't entered); 0 is a real zero basis.
    const rowBasis = (a: TaxBucketSnapshotAccount): number | null => {
      if (a.performanceAccountId == null) return null;
      const perf = perfById.get(a.performanceAccountId);
      if (!perf?.isActive || !tracksCostBasis(perf.accountType)) return null;
      if (perf.costBasis == null) return null;
      const total = rowsTotalByPerf.get(a.performanceAccountId) ?? 0;
      return total > 0
        ? roundToCents(toNumber(String(perf.costBasis)) * (a.amount / total))
        : 0;
    };

    for (const a of snapshotData.accounts) {
      // Only engine-relevant categories (Retirement + Portfolio) — pages
      // filter engine output by parentCategory for the correct subset.
      if (a.parentCategory && !ENGINE_CATEGORIES.has(a.parentCategory))
        continue;
      const knownBasis = rowBasis(a);
      const basis = knownBasis ?? 0;
      const ownerName = a.ownerPersonId
        ? personNameById.get(a.ownerPersonId)
        : undefined;
      const displayName = accountDisplayName(a, ownerName);
      const cat =
        a.subType && a.performanceAccountId != null
          ? (parentTypeByPerfId.get(a.performanceAccountId) ?? a.accountType)
          : a.accountType;
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- snapshot rows store one of the four tax types
      const key = a.taxType as PortfolioTaxType;
      portfolioByTaxType[key] += a.amount;

      const pCat = a.parentCategory ?? "Retirement";
      if (!portfolioByTaxTypeByParentCat[pCat]) {
        portfolioByTaxTypeByParentCat[pCat] = {
          ...emptyTaxBucketMap(),
          afterTaxBasis: 0,
        };
      }
      portfolioByTaxTypeByParentCat[pCat][key] += a.amount;
      portfolioByTaxType.afterTaxBasis += basis;
      portfolioByTaxTypeByParentCat[pCat].afterTaxBasis += basis;

      const catAsBalance = cat as AccountCategory;
      const balance = portfolioByAccount[catAsBalance];
      if (balance.structure === "roth_traditional") {
        if (isTaxFreeBucket(a.taxType)) addRoth(balance, a.amount);
        else addTraditional(balance, a.amount);
      } else {
        addBalance(balance, a.amount);
        if (basis > 0) addBasis(balance, basis);
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
        // No people yet: it's still the household's money, held under
        // "Joint" so it stays in the totals.
        const sharers =
          personNameById.size > 0
            ? Array.from(personNameById.values())
            : ["Joint"];
        for (const pName of sharers) {
          if (!balanceByPersonByCategory[pName])
            balanceByPersonByCategory[pName] = {};
          balanceByPersonByCategory[pName][cat] =
            (balanceByPersonByCategory[pName][cat] ?? 0) +
            a.amount / sharers.length;
        }
      }

      if (!accountBreakdownByCategory[cat])
        accountBreakdownByCategory[cat] = [];
      // Owner is in the merge key: same-named accounts of different people stay
      // separate rows, so per-owner eligibility (Rule of 55, 59½) sees the right owner.
      const existing = accountBreakdownByCategory[cat].find(
        (e) =>
          e.name === displayName &&
          e.taxType === a.taxType &&
          e.ownerPersonId === (a.ownerPersonId ?? undefined),
      );
      if (existing) {
        existing.amount += a.amount;
        if (
          a.performanceAccountId != null &&
          !existing.performanceAccountIds?.includes(a.performanceAccountId)
        )
          existing.performanceAccountIds = [
            ...(existing.performanceAccountIds ?? []),
            a.performanceAccountId,
          ];
        if (knownBasis != null)
          existing.costBasis = roundToCents((existing.costBasis ?? 0) + basis);
      } else {
        accountBreakdownByCategory[cat].push({
          name: displayName,
          amount: a.amount,
          taxType: a.taxType,
          ownerName,
          ownerPersonId: a.ownerPersonId ?? undefined,
          accountType: cat,
          parentCategory: a.parentCategory ?? undefined,
          ...(knownBasis != null ? { costBasis: basis } : {}),
          ...(a.performanceAccountId != null
            ? { performanceAccountIds: [a.performanceAccountId] }
            : {}),
        });
      }

      // Rollup on the same tuple as accountBreakdownByCategory so both merge alike.
      // Retirement-only: early-access rules don't apply to Portfolio brokerage, and
      // the "at retirement" join on this tuple excludes it too.
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
  for (const personBalances of Object.values(balanceByPersonByCategory)) {
    for (const [cat, amount] of Object.entries(personBalances)) {
      totalByCategory[cat] = (totalByCategory[cat] ?? 0) + amount;
    }
  }
  const portfolioTotal = sumBy(Object.values(totalByCategory), (v) => v);
  const ownershipByPerson: Record<string, Record<string, number>> = {};
  for (const [name, personBalances] of Object.entries(
    balanceByPersonByCategory,
  )) {
    ownershipByPerson[name] = {};
    let personTotal = 0;
    for (const [cat, amount] of Object.entries(personBalances)) {
      const catTotal = totalByCategory[cat] ?? 1;
      ownershipByPerson[name][cat] = safeDivide(amount, catTotal, 0);
      personTotal += amount;
    }
    ownershipByPerson[name]._overall = safeDivide(
      personTotal,
      portfolioTotal,
      0,
    );
  }

  portfolioByTaxType.afterTaxBasis = roundToCents(
    portfolioByTaxType.afterTaxBasis,
  );
  for (const bucket of Object.values(portfolioByTaxTypeByParentCat))
    bucket.afterTaxBasis = roundToCents(bucket.afterTaxBasis);

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
