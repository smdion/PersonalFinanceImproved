import { getDisplayConfig } from "@/lib/config/account-types";

/**
 * Strip trailing institution suffix from an account label.
 * e.g. "Alice 401k (Fidelity)" → "Alice 401k"
 *
 * Handles balanced parens only — won't strip if no closing paren at end.
 */
export function stripInstitutionSuffix(label: string): string {
  return label.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

/**
 * Resolve an owner display name from a peopleMap.
 * Returns "Joint" for null/undefined ownerPersonId (intentional joint account).
 * Throws if the id is set but missing from the map — that's a data-integrity
 * error (orphan FK), not a display problem.
 */
export function personDisplayName(
  ownerPersonId: number | null | undefined,
  peopleMap: Map<number, string>,
): string {
  if (ownerPersonId == null) return "Joint";
  const name = peopleMap.get(ownerPersonId);
  if (name == null) {
    throw new Error(`people.id=${ownerPersonId} not found in peopleMap`);
  }
  return name;
}

/**
 * Format a number as USD currency.
 */
export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Format a decimal as a percentage string (e.g., 0.2189 → "21.89%").
 */
export function formatPercent(value: number, decimals = 0): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

/**
 * Format a date string for display.
 * Accepts YYYY-MM-DD strings or Date objects.
 *
 * Presets:
 *  - 'short'   → "Jan 2025"       (month + year)
 *  - 'medium'  → "Jan 5, 2025"    (month + day + year)
 *  - 'default' → locale default    (e.g. "1/5/2025")
 */
export function formatDate(
  value: string | Date,
  preset: "short" | "medium" | "default" = "default",
): string {
  // Append T00:00:00 to date-only strings (e.g. "2020-11-01") to avoid timezone shift.
  // Don't append if the string already has a time component (ISO format from JSON serialization).
  const date =
    typeof value === "string"
      ? new Date(value.includes("T") ? value : value + "T00:00:00")
      : value;
  switch (preset) {
    case "short":
      return date.toLocaleDateString("en-US", {
        month: "short",
        year: "numeric",
      });
    case "medium":
      return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    case "default":
      return date.toLocaleDateString("en-US");
  }
}

/**
 * Format a large currency value in compact form (e.g., 1500000 → "$1.5M", 45000 → "$45k").
 * Suitable for chart axes and summary displays where full precision isn't needed.
 */
export function compactCurrency(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

/**
 * Format a number with commas (e.g., 1234567 → "1,234,567").
 */
export function formatNumber(value: number, decimals = 0): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

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
  // Priority 2: programmatic label (stored on performanceAccounts)
  if (account.accountLabel) {
    // When an owner name is provided and the label doesn't already include it,
    // rebuild with the owner prefix so duplicate account types (e.g. two IRAs
    // at the same institution) are distinguishable.
    if (
      ownerName &&
      !account.accountLabel.startsWith(ownerName) &&
      account.accountType &&
      account.institution
    ) {
      return buildAccountLabel({
        ownerName,
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
      ownerName,
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
    return ownerName ? `${ownerName} ${displayLabel}` : displayLabel;
  }
  return "Unknown";
}
