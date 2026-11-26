/** Engine tests write their starting money as tax buckets and per-category
 *  balances; the engine takes it once, as account parts. */
import type {
  AccountBalances,
  IndividualAccountInput,
  TaxBuckets,
} from "@/lib/pure/accounts/account-balances.types";
import type { ProjectionInput } from "@/lib/pure/engine/types";
import { syntheticOpeningParts } from "@/lib/pure/engine/opening-parts";
import { seedBrokerageBasis } from "@/lib/pure/engine/brokerage-basis";
import { accountIdKeyOf, isHeldPart } from "@/lib/pure/accounts/account-part";
import {
  isRetirementMoney,
  type AccountCategory,
  type ParentCategory,
} from "@/lib/config/account-types";
import { PERF_CATEGORY_RETIREMENT } from "@/lib/config/display-labels";

/** Starting money as fixtures write it: the tax buckets and the
 *  per-category balances, with accounts optional. */
type StartingMoney = {
  startingBalances: TaxBuckets;
  startingAccountBalances: AccountBalances;
  individualAccounts?: IndividualAccountInput[];
  /** With no held account, whose money each category's synthetic parts
   *  hold (default Retirement): a goal fixture's brokerage is Portfolio's. */
  syntheticParents?: Partial<Record<AccountCategory, ParentCategory>>;
};

/**
 * A fixture account as the payload gives it: a held part with neither id
 * takes a performance account id from its name, category and parent, so an
 * account's tax and owner parts stay one account and its same-named accounts
 * of other categories or parents stay apart.
 */
export function withAccountId<T extends IndividualAccountInput>(ia: T): T {
  if (!isHeldPart(ia) || ia.performanceAccountId != null) return ia;
  if (ia.portfolioAccountId != null) return ia;
  return { ...ia, performanceAccountId: fixtureAccountId(ia) };
}

/** `withAccountId` over a fixture's accounts. */
export function withAccountIds<T extends IndividualAccountInput>(
  parts: T[],
): T[] {
  return parts.map(withAccountId);
}

/** A fixture account's performance account id: one per (name, category,
 *  parent), above the ids tests write by hand. Retirement money (Retirement
 *  or no parent) hashes as (name, category); owners never enter the hash. */
function fixtureAccountId(
  ia: Pick<IndividualAccountInput, "name" | "category" | "parentCategory">,
) {
  const parent = isRetirementMoney(ia.parentCategory)
    ? ""
    : `::${ia.parentCategory}`;
  let hash = 0;
  for (const ch of `${ia.name}::${ia.category}${parent}`)
    hash = (hash * 31 + ch.charCodeAt(0)) % 1_000_000;
  return 1_000_000 + hash;
}

/** An engine input as fixtures write it. */
export type FixtureInput = Omit<ProjectionInput, "individualAccounts"> &
  StartingMoney;

/**
 * The engine input for a fixture. With a held account, the accounts are the
 * starting money, and a brokerage part with no basis of its own takes its
 * share of the fixture's basis by balance. Without, synthetic parts hold the
 * per-category balances.
 */
export function engineInput(fixture: FixtureInput): ProjectionInput;
export function engineInput<T extends StartingMoney>(
  fixture: T,
): Omit<T, keyof StartingMoney> & {
  individualAccounts: IndividualAccountInput[];
};
export function engineInput(fixture: StartingMoney) {
  const {
    startingBalances,
    startingAccountBalances,
    individualAccounts,
    syntheticParents,
    ...rest
  } = fixture;
  // Parts that are all synthetic are already the starting money (an engine
  // input passed back through a fixture builder): kept as given.
  if (
    individualAccounts?.length &&
    individualAccounts.every((ia) => ia.origin === "synthetic")
  )
    return { ...rest, individualAccounts };
  if (!individualAccounts?.some(isHeldPart))
    return {
      ...rest,
      individualAccounts: syntheticOpeningParts(
        startingAccountBalances,
        (category) => syntheticParents?.[category] ?? PERF_CATEGORY_RETIREMENT,
      ),
    };
  const parts = withAccountIds(individualAccounts);
  const basis = seedBrokerageBasis(
    parts,
    accountIdKeyOf,
    startingBalances.afterTaxBasis,
  );
  return {
    ...rest,
    individualAccounts: parts.map((ia) => {
      const shared = basis.get(accountIdKeyOf(ia));
      return ia.startingBasis == null && shared != null
        ? { ...ia, startingBasis: shared }
        : ia;
    }),
  };
}
