/** A Roth conversion's account parts for a test that states only tax
 *  buckets, and the settled point's refresh after it. */
import type {
  AccountBalances,
  IndividualAccountInput,
  TaxBuckets,
} from "@/lib/pure/accounts/account-balances.types";
import type { ConversionParts } from "@/lib/pure/engine/individual-accounts/conversion";
import type { RothConversionInput } from "@/lib/pure/engine/roth-conversion";
import { makeIndKey } from "@/lib/pure/engine/individual-accounts/ledger";
import { openingTotals } from "@/lib/pure/engine/opening-parts";
import { refreshViews } from "@/lib/pure/engine/projection-year-handlers/settle";
import type {
  ProjectionContext,
  ProjectionLoopState,
} from "@/lib/pure/engine/projection-year-handlers/types";
import { makeIndividualAccount } from "./engine-fixtures";

/** One Retirement-parented account per bucket's money: a 401(k)'s
 *  Traditional and Roth parts, an HSA, a brokerage at the buckets' basis.
 *  `accountBalance` is set in place to what the parts hold. */
export function conversionParts(
  balances: TaxBuckets,
  accountBalance: AccountBalances,
): ConversionParts {
  const traditional = makeIndividualAccount({
    name: "401k",
    category: "401k",
    taxType: "preTax",
    startingBalance: balances.preTax,
    parentCategory: "Retirement",
  });
  const brokerage = makeIndividualAccount({
    name: "Brokerage",
    category: "brokerage",
    taxType: "afterTax",
    startingBalance: balances.afterTax,
    startingBasis: balances.afterTaxBasis,
    parentCategory: "Retirement",
  });
  const accounts: IndividualAccountInput[] = [
    traditional,
    { ...traditional, taxType: "taxFree", startingBalance: balances.taxFree },
    makeIndividualAccount({
      name: "HSA",
      category: "hsa",
      taxType: "hsa",
      startingBalance: balances.hsa,
      parentCategory: "Retirement",
    }),
    brokerage,
  ];
  const keyOf = makeIndKey();
  Object.assign(accountBalance, openingTotals(accounts).accountBalance);
  return {
    accounts,
    balances: new Map(accounts.map((a) => [keyOf(a), a.startingBalance])),
    keyOf,
    basis: new Map([[keyOf(brokerage), balances.afterTaxBasis]]),
  };
}

/** The settled point after the conversion: the input's categories and tax
 *  buckets refreshed from its parts. */
export function settleConversion(input: RothConversionInput) {
  const { parts } = input;
  const run = { indAccounts: parts.accounts, indKey: parts.keyOf };
  const loop = {
    balances: input.balances,
    accountBalance: input.accountBalance,
    indBalance: parts.balances,
    brokBasis: parts.basis,
  };
  refreshViews(
    // eslint-disable-next-line no-restricted-syntax -- only the fields refreshViews reads
    run as unknown as ProjectionContext,
    // eslint-disable-next-line no-restricted-syntax -- only the fields refreshViews reads
    loop as unknown as ProjectionLoopState,
  );
}
