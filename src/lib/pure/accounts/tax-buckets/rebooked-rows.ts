/** Snapshot rows saved with a tax type their account type doesn't hold: the
 *  projection counts each as its account type's (`bookedTaxType`). */
import { getDisplayConfig } from "@/lib/config/account-types";
import { taxTypeLabel } from "@/lib/config/display-labels";
import {
  bookedTaxType,
  taxTypesHeldBy,
} from "@/lib/config/tax-treatment-buckets";
import { withRowCategories } from "@/lib/pure/accounts/tax-buckets/snapshot-row-category";
import {
  isProjectedRow,
  type TaxBucketSnapshotAccount,
} from "@/lib/pure/accounts/tax-buckets/tax-buckets";
import { snapshotAccountKey } from "@/lib/pure/accounts/portfolio";
import { accountDisplayName } from "@/lib/utils/account-name";

/** The stored facts a row's booking reads. */
export type RowFacts = Pick<
  TaxBucketSnapshotAccount,
  "taxType" | "accountType" | "subType" | "performanceAccountId"
>;

/** A row's facts with its owner: enough to name its account part. */
type PartFacts = RowFacts & Pick<TaxBucketSnapshotAccount, "ownerPersonId">;

/** Each row whose stored tax type isn't its booked one, with its category
 *  and booked tax type, in the rows' order. */
function rebookedRows<R extends RowFacts>(rows: readonly R[]) {
  return withRowCategories(rows).flatMap(({ row, category }) => {
    const booked = bookedTaxType(category, row.taxType);
    return booked === row.taxType ? [] : [{ row, category, booked }];
  });
}

/** Entry's refusal for each row `rebookedRows` finds: the tax types its
 *  account type holds (`taxTypesHeldBy`), in the rows' order. */
export function taxTypeRefusals<R extends RowFacts>(rows: readonly R[]) {
  return rebookedRows(rows).map(({ row, category }) => ({
    row,
    message: `${getDisplayConfig(category).displayLabel} balances can't be saved as ${taxTypeLabel(row.taxType)}. Choose ${taxTypesHeldBy(category).map(taxTypeLabel).join(" or ")}.`,
  }));
}

/** A new snapshot's refusals, leaving out each row carried over from
 *  `previousRows` (same account part, `snapshotAccountKey`, and account
 *  type): that is old data, which the read counts as its account type's. */
export function newRowRefusals<R extends PartFacts>(
  rows: readonly R[],
  previousRows: readonly PartFacts[],
) {
  const carried = new Set(
    previousRows.map((p) => `${snapshotAccountKey(p)}|${p.accountType}`),
  );
  return taxTypeRefusals(rows).filter(
    ({ row }) => !carried.has(`${snapshotAccountKey(row)}|${row.accountType}`),
  );
}

/** One note per projected row `rebookedRows` finds, naming the row and both
 *  tax types. */
export function rebookedRowsWarning(
  rows: readonly TaxBucketSnapshotAccount[],
  people: readonly { id: number; name: string }[],
): string[] {
  return rebookedRows(rows)
    .filter(({ row }) => isProjectedRow(row))
    .map(({ row, category, booked }) => {
      const ownerName = people.find((p) => p.id === row.ownerPersonId)?.name;
      return `${accountDisplayName(row, ownerName)} is saved as ${taxTypeLabel(row.taxType)}, which the projection doesn't model for a ${getDisplayConfig(category).displayLabel} account, so it counts this balance as ${taxTypeLabel(booked)}. Its tax type can be changed on the Contributions page.`;
    });
}
