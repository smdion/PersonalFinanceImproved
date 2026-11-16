/** Engine tests write their starting money as tax buckets and per-category
 *  balances; the engine takes it once, as account parts. */
import type {
  AccountBalances,
  IndividualAccountInput,
  TaxBuckets,
} from "@/lib/pure/accounts/account-balances.types";
import type { ProjectionInput } from "@/lib/pure/engine/types";
import { syntheticOpeningParts } from "@/lib/pure/engine/opening-state";
import { seedBrokerageBasis } from "@/lib/pure/engine/brokerage-basis";
import { accountKeyOf, isHeldPart } from "@/lib/pure/accounts/account-part";

/** Starting money as fixtures write it: the tax buckets and the
 *  per-category balances, with accounts optional. */
type StartingMoney = {
  startingBalances: TaxBuckets;
  startingAccountBalances: AccountBalances;
  individualAccounts?: IndividualAccountInput[];
};

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
export function engineInput(fixture: StartingMoney): {
  individualAccounts?: IndividualAccountInput[];
} {
  const {
    startingBalances,
    startingAccountBalances,
    individualAccounts,
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
      individualAccounts: syntheticOpeningParts(startingAccountBalances),
    };
  const basis = seedBrokerageBasis(
    individualAccounts,
    accountKeyOf,
    startingBalances.afterTaxBasis,
  );
  return {
    ...rest,
    individualAccounts: individualAccounts.map((ia) => {
      const shared = basis.get(accountKeyOf(ia));
      return ia.startingBasis == null && shared != null
        ? { ...ia, startingBasis: shared }
        : ia;
    }),
  };
}
