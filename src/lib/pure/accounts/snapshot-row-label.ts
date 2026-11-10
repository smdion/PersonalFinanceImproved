/**
 * The label of one snapshot sub-row (a portfolio_accounts row under its
 * performance account), shared by the Portfolio page's snapshot table and
 * the New Snapshot form. DESIGN.md "Snapshot Display".
 */
import { getDisplayConfig } from "@/lib/config/account-types";
import { taxTypeLabel } from "@/lib/config/display-labels";

export interface SnapshotRowLabelInput {
  /** Who owns the row, when the owner prefix applies (a joint performance
   *  account whose rows carry different owners); null otherwise. */
  owner: string | null;
  taxType: string;
  /** Free-text override; wins over `subType` when set. */
  label: string | null;
  subType: string | null;
  accountType: string;
  /** The parent performance account's type; null when unlinked. */
  perfAccountType: string | null;
}

export function snapshotRowLabel(row: SnapshotRowLabelInput): string {
  const taxLabel = taxTypeLabel(row.taxType);
  // DESIGN.md's sub-account-type rule only names subType, but `label` is a
  // real, separate free-text override column on portfolio_accounts — it
  // takes precedence when set (see DESIGN.md).
  const displayName = row.label || row.subType;

  let typeLabel: string;
  if (displayName) {
    typeLabel = displayName;
  } else {
    // Documented rule (DESIGN.md): show accountType only if it differs from
    // the parent performance account's type — that's the whole test (not
    // also `accountType !== taxType`: "hsa" vs "hsa" isn't in the spec).
    typeLabel =
      row.accountType.toLowerCase() !==
      (row.perfAccountType ?? "").toLowerCase()
        ? getDisplayConfig(row.accountType).displayLabel
        : taxLabel;
  }

  if (row.owner) {
    // Owner prefix uses an em dash (WHO owns it), distinct from the parens
    // used below for WHAT kind of sub-account it is (e.g. "Employer Match
    // (Traditional)").
    const qualifier =
      typeLabel !== taxLabel ? `${typeLabel} · ${taxLabel}` : typeLabel;
    return `${row.owner} — ${qualifier}`;
  }

  return typeLabel !== taxLabel ? `${typeLabel} (${taxLabel})` : typeLabel;
}
