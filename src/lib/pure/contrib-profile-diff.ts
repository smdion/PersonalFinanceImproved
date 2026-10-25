/**
 * Contribution Profile swap-safety diff.
 *
 * A Contribution Profile only marks an account ACTIVE (its own value) when
 * that value genuinely differs from the account's own live row; an account
 * left untouched just uses the account's own value. Swapping which profile
 * is active can therefore silently change — or entirely drop — an active
 * value for any account the outgoing profile touched but the incoming one
 * doesn't. This computes the human-readable diff shown before that swap.
 */

import { takesFromBonusCheck } from "@/lib/calculators/paycheck";

export type ContribFieldSet = {
  contributionValue?: string | number | null;
  contributionMethod?: string | null;
  employerMatchType?: string | null;
  employerMatchValue?: string | number | null;
  employerMaxMatchPct?: string | number | null;
  autoMaximize?: boolean | null;
  isActive?: boolean | null;
  /** Also taken from bonus checks — absent means no. */
  fromBonus?: boolean | null;
  /** A Roth IRA account's route — absent means direct. */
  rothRoute?: string | null;
  /** Cosmetic only — deliberately excluded from the comparison below. */
  displayNameCustom?: string | null;
  /** @deprecated legacy key. */
  displayNameActive?: string | null;
};

export type DiffAccount = {
  id: number;
  accountName: string;
  /** Paid through payroll — only then does `fromBonus` mean anything
   *  (takesFromBonusCheck). Absent = yes. */
  isPayroll?: boolean;
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

function fieldsDiffer(
  a: ContribFieldSet,
  b: ContribFieldSet,
  isPayroll: boolean,
): boolean {
  return (
    COMPARED_FIELDS.some((field) => a[field] !== b[field]) ||
    // Absent means direct, so absent and "direct" are the same route.
    (a.rothRoute ?? "direct") !== (b.rothRoute ?? "direct") ||
    // Absent means no, so absent and false are the same election.
    takesFromBonusCheck({
      isPayrollDeducted: isPayroll,
      fromBonus: a.fromBonus ?? undefined,
    }) !==
      takesFromBonusCheck({
        isPayrollDeducted: isPayroll,
        fromBonus: b.fromBonus ?? undefined,
      })
  );
}

function formatValue(fields: ContribFieldSet, isPayroll: boolean): string {
  if (fields.isActive === false) return "excluded";
  const isPercent = fields.contributionMethod === "percent_of_salary";
  const value = fields.contributionValue;
  if (value == null) return "using account's own value";
  const amount = `${isPercent ? `${value}%` : String(value)}${
    fields.rothRoute === "backdoor" ? " via backdoor" : ""
  }`;
  return takesFromBonusCheck({
    isPayrollDeducted: isPayroll,
    fromBonus: fields.fromBonus ?? undefined,
  })
    ? `${amount} + bonus checks`
    : amount;
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

    const isPayroll = account.isPayroll !== false;
    if (!fieldsDiffer(outgoingFields, effectiveIncoming, isPayroll)) continue;

    const from = formatValue(outgoingFields, isPayroll);
    const to =
      incomingFields && Object.keys(incomingFields).length > 0
        ? formatValue(incomingFields, isPayroll)
        : `using account's own value (currently ${formatValue(account.live, isPayroll)})`;
    lines.push(`${account.accountName}: ${from} → ${to}`);
  }
  return lines;
}
