/** Money saved under an account type this version doesn't know: the
 *  projection and Tax Buckets leave it out, and say so. */
import {
  projectedRowsByType,
  type TaxBucketSnapshotAccount,
} from "@/lib/pure/accounts/tax-buckets/tax-buckets";
import type { StoredAccountType } from "@/lib/config/account-types.types";
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
