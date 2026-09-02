/**
 * Contribution Profile swap-safety diff (R20).
 *
 * A Contribution Profile only marks an account ACTIVE (its own value) when
 * that value genuinely differs from the account's own live row; an account
 * left untouched just uses the account's own value. Swapping which profile
 * is active can therefore silently change — or entirely drop — an active
 * value for any account the outgoing profile touched but the incoming one
 * doesn't. This computes the human-readable diff shown before that swap.
 */

export type ContribFieldSet = {
  contributionValue?: string | number | null;
  contributionMethod?: string | null;
  employerMatchType?: string | null;
  employerMatchValue?: string | number | null;
  employerMaxMatchPct?: string | number | null;
  autoMaximize?: boolean | null;
  isActive?: boolean | null;
  /** Cosmetic only — deliberately excluded from the comparison below. */
  displayNameCustom?: string | null;
  /** @deprecated R22 legacy key. */
  displayNameActive?: string | null;
};

export type DiffAccount = {
  id: number;
  accountName: string;
  live: ContribFieldSet;
};

/** Fields that carry financial meaning. displayNameCustom is intentionally
 *  excluded — a custom display name differing between profiles isn't a
 *  value silently changing underneath anyone. */
const COMPARED_FIELDS = [
  "contributionValue",
  "contributionMethod",
  "employerMatchType",
  "employerMatchValue",
  "employerMaxMatchPct",
  "autoMaximize",
  "isActive",
] as const;

function fieldsDiffer(a: ContribFieldSet, b: ContribFieldSet): boolean {
  return COMPARED_FIELDS.some((field) => a[field] !== b[field]);
}

function formatValue(fields: ContribFieldSet): string {
  if (fields.isActive === false) return "excluded";
  const isPercent = fields.contributionMethod === "percent_of_salary";
  const value = fields.contributionValue;
  if (value == null) return "using account's own value";
  return isPercent ? `${value}%` : String(value);
}

/**
 * One line per account whose effective value would change if `outgoing`
 * were swapped out for `incoming`. Only accounts the outgoing profile
 * actually touches (a non-empty entry in `outgoing`) can produce a line —
 * an account neither profile touches never changes.
 */
export function diffContribProfileSwap(
  outgoing: Record<string, ContribFieldSet>,
  incoming: Record<string, ContribFieldSet>,
  accounts: DiffAccount[],
): string[] {
  const lines: string[] = [];
  for (const account of accounts) {
    const key = String(account.id);
    const outgoingFields = outgoing[key];
    if (!outgoingFields || Object.keys(outgoingFields).length === 0) continue;

    const incomingFields = incoming[key];
    const effectiveIncoming =
      incomingFields && Object.keys(incomingFields).length > 0
        ? incomingFields
        : account.live;

    if (!fieldsDiffer(outgoingFields, effectiveIncoming)) continue;

    const from = formatValue(outgoingFields);
    const to =
      incomingFields && Object.keys(incomingFields).length > 0
        ? formatValue(incomingFields)
        : `using account's own value (currently ${formatValue(account.live)})`;
    lines.push(`${account.accountName}: ${from} → ${to}`);
  }
  return lines;
}
