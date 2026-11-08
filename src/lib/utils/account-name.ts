import { getDisplayConfig } from "@/lib/config/account-types";

/**
 * Build a programmatic account label from structured fields.
 * Formula: {Owner} {Label?} {SubType || Type} ({Institution})
 * Uses displayLabel from config for proper casing (e.g. 'hsa' → 'HSA').
 *
 * Examples:
 *   Alice + 401k + Fidelity          → "Alice 401k (Fidelity)"
 *   Bob + ESPP subType + UBS        → "Bob ESPP (UBS)"
 *   Joint + "Long Term" label + brokerage + Vanguard → "Long Term Brokerage (Vanguard)"
 *   Joint + IRA + Vanguard          → "IRA (Vanguard)"
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

/**
 * Build a human-readable display name for an account.
 * Priority: displayName (user override) > accountLabel (programmatic).
 * All pages must use this function — never inline `displayName ?? accountLabel`.
 */
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

  // Priority 2: programmatic label (stored on performanceAccounts)
  if (account.accountLabel) {
    // Rebuild with the correct prefix when the stored label doesn't already
    // start with it. This corrects labels stored before the joint-prefix rule
    // was introduced without requiring a DB migration.
    if (
      effectiveOwner &&
      !account.accountLabel.startsWith(effectiveOwner) &&
      account.accountType &&
      account.institution
    ) {
      return buildAccountLabel({
        ownerName: effectiveOwner,
        accountType: account.accountType,
        subType: account.subType,
        label: account.label,
        institution: account.institution,
      });
    }
    return account.accountLabel;
  }
  // Priority 3: construct on the fly (fallback for objects without accountLabel)
  if (account.accountType && account.institution) {
    return buildAccountLabel({
      ownerName: effectiveOwner,
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
