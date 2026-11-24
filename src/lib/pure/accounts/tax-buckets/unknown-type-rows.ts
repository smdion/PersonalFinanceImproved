/** Money saved under an account type this version doesn't know: the
 *  projection and Tax Buckets leave it out, and say so. */
import {
  projectedRowsByType,
  type TaxBucketSnapshotAccount,
} from "@/lib/pure/accounts/tax-buckets/tax-buckets";
import type { StoredAccountType } from "@/lib/config/account-types.types";
import {
  isKnownCategory,
  type AccountCategory,
} from "@/lib/config/account-types";
import { accountDisplayName } from "@/lib/utils/account-name";

/** A projected snapshot row of an unknown account type, as stored. */
export type UnknownTypeRow = {
  portfolioAccountId: number;
  name: string;
  accountType: StoredAccountType;
  amount: number;
};

/** Each projected row whose category this version doesn't know
 *  (`projectedRowsByType`), in the rows' order. */
export function unknownTypeRows(
  rows: readonly TaxBucketSnapshotAccount[],
  people: readonly { id: number; name: string }[],
): UnknownTypeRow[] {
  return projectedRowsByType(rows).unknown.map(({ row, category }) => ({
    portfolioAccountId: row.portfolioAccountId,
    name: accountDisplayName(
      row,
      people.find((p) => p.id === row.ownerPersonId)?.name,
    ),
    accountType: category,
    amount: row.amount,
  }));
}

/** The note for one, naming its amount (whole dollars, formatted as the
 *  engine's own warnings are: it is cached with them, unmasked). */
export function unknownTypeNote(fact: UnknownTypeRow): string {
  return `${fact.name} is saved as account type "${fact.accountType}", which this version doesn't know, so the projection and Tax Buckets leave out its $${Math.round(fact.amount).toLocaleString("en-US")}. Update Ledgr or change its account type.`;
}

/** Contribution accounts split by whether this version knows their stored
 *  type: the projection reads only the `known` ones. */
export function contributionsByType<
  R extends { accountType: StoredAccountType },
>(
  rows: readonly R[],
): { known: (R & { accountType: AccountCategory })[]; unknown: R[] } {
  const known: (R & { accountType: AccountCategory })[] = [];
  const unknown: R[] = [];
  for (const row of rows) {
    const { accountType } = row;
    if (isKnownCategory(accountType)) known.push({ ...row, accountType });
    else unknown.push(row);
  }
  return { known, unknown };
}

/** The note for a contribution account `contributionsByType` leaves out. */
export function unknownTypeContributionNote(
  name: string,
  accountType: StoredAccountType,
): string {
  return `${name} is saved as account type "${accountType}", which this version doesn't know, so the projection leaves out its contributions. Update Ledgr or change its account type.`;
}
