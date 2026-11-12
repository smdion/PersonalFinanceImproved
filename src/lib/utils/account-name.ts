import { getDisplayConfig } from "@/lib/config/account-types";

/**
 * Programmatic account label: {Owner?} {Label?} {SubType || Type} ({Institution}),
 * cased by the config displayLabel (e.g. "Alice 401k (Fidelity)").
 */
export function buildAccountLabel(params: {
  ownerName?: string | null;
  accountType: string;
  subType?: string | null;
  label?: string | null;
  institution: string;
}): string {
  const parts: string[] = [];
  if (params.ownerName) parts.push(params.ownerName);
  if (params.label) parts.push(params.label);
  // Use config displayLabel for proper casing (e.g. 'hsa' → 'HSA', 'brokerage' → 'Brokerage')
  const { displayLabel } = getDisplayConfig(params.accountType, params.subType);
  parts.push(displayLabel);
  const name = parts.join(" ");
  return `${name} (${params.institution})`;
}

/** An account's display name: displayName > built from its parts when the
 *  owner is known > the stored accountLabel > built with no owner. Every page
 *  uses this, never an inline `displayName ?? accountLabel`. */
export function accountDisplayName(
  account: {
    accountType?: string;
    subType?: string | null;
    label?: string | null;
    institution?: string;
    displayName?: string | null;
    accountLabel?: string | null;
    ownershipType?: string | null;
  },
  ownerName?: string,
): string {
  // Priority 1: user-set friendly name
  if (account.displayName) return account.displayName;

  // Joint accounts always show "Joint" prefix; individual accounts use the
  // provided ownerName. When ownershipType is absent the caller's ownerName
  // is used as-is (backward-compat for objects that don't carry the field).
  const effectiveOwner =
    account.ownershipType === "joint" ? "Joint" : ownerName;

  // Priority 2: the label built from its parts whenever the owner is known
  // (joint, or the caller's owner name), so a person's rename shows at once;
  // the stored programmatic label only names an owner the caller didn't give.
  if (effectiveOwner && account.accountType && account.institution)
    return buildAccountLabel({
      ownerName: effectiveOwner,
      accountType: account.accountType,
      subType: account.subType,
      label: account.label,
      institution: account.institution,
    });
  if (account.accountLabel) return account.accountLabel;
  // Priority 3: built with no owner (no owner known, no stored label)
  if (account.accountType && account.institution) {
    return buildAccountLabel({
      accountType: account.accountType,
      subType: account.subType,
      label: account.label,
      institution: account.institution,
    });
  }
  // Last resort — never return raw DB keys like "401k"; use config display labels
  if (account.accountType) {
    const { displayLabel } = getDisplayConfig(
      account.accountType,
      account.subType,
    );
    return effectiveOwner ? `${effectiveOwner} ${displayLabel}` : displayLabel;
  }
  return "Unknown";
}
