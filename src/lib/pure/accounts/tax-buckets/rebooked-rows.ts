/** Snapshot rows saved with a tax type their account type doesn't hold: the
 *  projection counts each as its account type's (`bookedTaxType`). */
import { getDisplayConfig } from "@/lib/config/account-types";
import { taxTypeLabel } from "@/lib/config/display-labels";
import { bookedTaxType } from "@/lib/config/tax-treatment-buckets";
import { withRowCategories } from "@/lib/pure/accounts/tax-buckets/snapshot-row-category";
import {
  isProjectedRow,
  type TaxBucketSnapshotAccount,
} from "@/lib/pure/accounts/tax-buckets/tax-buckets";
import { accountDisplayName } from "@/lib/utils/account-name";

/** The stored facts a row's booking reads. */
type RowFacts = Pick<
  TaxBucketSnapshotAccount,
  "taxType" | "accountType" | "subType" | "performanceAccountId"
>;

/** Each row whose stored tax type isn't its booked one, with its category
 *  and booked tax type, in the rows' order. */
function rebookedRows<R extends RowFacts>(rows: readonly R[]) {
  return withRowCategories(rows).flatMap(({ row, category }) => {
    const booked = bookedTaxType(category, row.taxType);
    return booked === row.taxType ? [] : [{ row, category, booked }];
  });
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
