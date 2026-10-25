/**
 * Plain-language help for entering Performance figures: what each field
 * holds (and the usual traps), situation tips by account type, and the
 * wording of the reconciliation checks (lib/pure/performance-checks.ts).
 * Copy lives here, not in components, so the form, the table and Finalize
 * say the same thing.
 */
import type { PerfCheck, PerfCheckKind } from "@/lib/pure/performance-checks";
import type { PerfField } from "@/lib/pure/performance-annotations";
import { getDisplayConfig } from "@/lib/config/account-types";
import { formatCurrency } from "@/lib/utils/format";

export const PERF_FIELD_HELP: Record<
  PerfField,
  { label: string; help: string }
> = {
  beginningBalance: {
    label: "Beginning",
    help: "Where the year started: last year's ending.",
  },
  employeeContrib: {
    label: "You added",
    help: "New money you put in: payroll deductions and deposits from your bank. Not money moved from another account you track (that's a transfer), and not a conversion from an IRA you don't track.",
  },
  employerContributions: {
    label: "Employer added",
    help: "Money from your employer: a match, profit sharing, HSA deposits, or an ESPP discount.",
  },
  distributions: {
    label: "Paid out to you",
    help: "Withdrawals, or dividends paid to your bank. Not dividends that stayed in the account — they're already in the balance. Refunded or reversed withdrawals reduce this.",
  },
  rollovers: {
    label: "Moved between accounts",
    help: "Money moved between accounts you track: + on the account it arrived in, − on the one it left. Enter both sides. Money from an account you don't track goes here too (one side only).",
  },
  fees: {
    label: "Fees & taxes withheld",
    help: "Fees, and taxes taken out (e.g. foreign tax withheld on dividends). Statements sometimes list these as debits.",
  },
  endingBalance: {
    label: "Ending",
    help: "The statement's total value on the last day. If a buy was placed but hadn't settled, the total already nets the new shares against the cash owed — use the total, not the holdings line.",
  },
  yearlyGainLoss: {
    label: "Gain/loss",
    help: "Worked out from the other figures. Enter the provider's figure only on purpose: the row then shows what it leaves unexplained.",
  },
};

type TipRule = {
  /** Applies to these account types (category keys), or any when absent. */
  accountTypes?: readonly string[];
  /** Applies when employer money is a purchase discount (ESPP). */
  discountBasis?: boolean;
  tip: string;
};

const TIPS: readonly TipRule[] = [
  {
    discountBasis: true,
    tip: "Count each purchase at market value: what you paid ÷ (1 − your plan's discount). The difference is the employer part. Withholding refunded before a purchase never reached the account — leave it out here.",
  },
  {
    accountTypes: ["ira"],
    tip: "Contributions are new money only. A conversion from a Traditional IRA you don't track moves money; it isn't a new contribution. Money contributed last year and converted this year belongs to last year.",
  },
  {
    accountTypes: ["hsa"],
    tip: "Employer HSA deposits go under Employer added. A withdrawal that was refunded or reversed reduces Paid out to you.",
  },
  {
    accountTypes: ["401k", "403b"],
    tip: "Take the year's employee, employer and fee totals from the year-to-date columns of the latest statement. Quarterly admin fees often appear as debits.",
  },
  {
    accountTypes: ["brokerage"],
    discountBasis: false,
    tip: "Dividends that are reinvested or left as cash are part of the gain, not Paid out to you.",
  },
];

/** Situation tips for an account, from its type and plan features. */
export function performanceTips(
  accountType: string | null,
  subType: string | null,
): string[] {
  if (!accountType) return [];
  const discount =
    getDisplayConfig(accountType, subType).employerContribKind === "discount";
  return TIPS.filter(
    (t) =>
      (!t.accountTypes || t.accountTypes.includes(accountType)) &&
      (t.discountBasis === undefined || t.discountBasis === discount),
  ).map((t) => t.tip);
}

const money = (n: number) => formatCurrency(Math.abs(n));

/** A check in plain words: what's off, and what usually fixes it. */
export function describeCheck(c: PerfCheck): { title: string; help: string } {
  switch (c.kind) {
    case "unbalanced":
      return {
        title: `Doesn't add up by ${money(c.amount)}`,
        help: "Ending − beginning − added + paid out − moved in + fees should equal the gain. Usually a gain entered from the provider (accept it if that's on purpose), or something added, paid out or withheld that isn't entered. A new snapshot moves the ending before the gain is updated, so this shows until the next update.",
      };
    case "chain":
      return {
        title: `Starts ${money(c.amount)} ${c.amount > 0 ? "above" : "below"} ${c.previousYear}'s ending (${formatCurrency(c.previousEnding)})`,
        help: "A year should start where the last one ended; usually one side was corrected and the other wasn't. At year end use the statement's total value — a buy placed on the last day but settled after shows as shares plus negative cash.",
      };
    case "transfers":
      return {
        title: c.accepted
          ? "Moved money with no tracked other side"
          : `Moves between tracked accounts are off by ${money(c.amount)} this year`,
        help: "Money moved between two accounts tracked here goes on both: + where it arrived, − where it left. If one side is missing, add it. If it came from (or went to) an account you don't track, or crossed year end, accept it.",
      };
    case "snapshot":
      return {
        title: `Ending is ${money(c.amount)} ${c.amount > 0 ? "above" : "below"} the ${c.snapshotDate} snapshot (${formatCurrency(c.snapshotBalance)})`,
        help: "A year's ending usually matches its last snapshot. If the statement's total differs from the snapshot, correct whichever is wrong.",
      };
  }
}

export const PERF_CHECK_LABELS: Record<PerfCheckKind, string> = {
  unbalanced: "Doesn't add up",
  chain: "Doesn't continue last year",
  transfers: "Transfers don't match",
  snapshot: "Differs from snapshot",
};
