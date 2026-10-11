/**
 * Suggested portfolio snapshot balances from linked SimpleFIN accounts.
 * Pure; suggestions only — the household confirms the snapshot.
 *
 * A sub-account linked on its own takes its feed's balance. A feed linked
 * to the whole tracked account covers that account's other sub-accounts:
 * with one left it's exact; with several (a plan reporting one balance for
 * its Roth, Traditional, match and rollover parts) the change since the
 * last snapshot is placed as an estimate — new contributions go to the part
 * they land in (employee Roth → Roth, pre-tax → Traditional, after-tax →
 * after-tax, employer → the match part of that tax type when the plan
 * tracks one), and the balance is then divided by each part's prior amount
 * plus what was placed into it — so the market's move is shared out by
 * size and no part goes negative.
 */
import {
  isAfterTaxType,
  isPreTaxType,
  isTaxFreeBucket,
} from "@/lib/config/account-types";
import { roundToCents } from "@/lib/utils/math";

export type SnapshotSub = {
  key: string;
  performanceAccountId: number;
  taxType: string;
  subType: string | null;
  /** Latest snapshot amount. */
  amount: number;
};

export type SnapshotFeed = {
  performanceAccountId: number;
  subKey: string | null;
  balance: number;
  /** Day the institution's balance is from. */
  balanceDate: string | null;
};

/** Contributions since the last snapshot into one account, by who and how taxed. */
export type NewMoney = {
  employeeRoth: number;
  employeePreTax: number;
  /** After-tax money the employee puts in. */
  employeeOther: number;
  employer: number;
  /** The Roth part of `employer`. */
  employerRoth: number;
  /** True when estimated from the paycheck setup (no transactions from the feed). */
  estimated: boolean;
};

export type SnapshotAccountNote = {
  /** The feeds' total balance. */
  total: number;
  balanceDate: string | null;
  /** True when one balance was divided across several parts. */
  split: boolean;
  /** Contributions placed before spreading the market's move. */
  newMoney: number;
  newMoneyEstimated: boolean;
};

export type SnapshotSuggestions = {
  amounts: Map<string, number>;
  accounts: Map<number, SnapshotAccountNote>;
};

const earliest = (days: (string | null)[]) =>
  days.includes(null) ? null : ([...days].sort()[0] ?? null);

/**
 * Divide `total` across `parts`; see the module comment. Each part's weight
 * is its prior amount plus the new money placed into it, so no part can go
 * below zero, and the parts sum exactly to `total`.
 */
export function splitAccountBalance(
  parts: readonly SnapshotSub[],
  total: number,
  newMoney: NewMoney | null,
  employerMatchSubType: string | null,
): { amounts: Map<string, number>; placed: number } {
  const find = (subType: string | null, bucket: (t: string) => boolean) =>
    parts.find((p) => p.subType === subType && bucket(p.taxType));
  const roth = find(null, isTaxFreeBucket);
  const preTax = find(null, isPreTaxType);
  const afterTax = find(null, isAfterTaxType);
  const matchRoth = employerMatchSubType
    ? (find(employerMatchSubType, isTaxFreeBucket) ?? roth)
    : roth;
  const matchPreTax = employerMatchSubType
    ? (find(employerMatchSubType, isPreTaxType) ?? preTax)
    : preTax;

  const added = new Map<string, number>();
  let placed = 0;
  const place = (part: SnapshotSub | undefined, amount: number) => {
    if (!part || amount <= 0) return;
    added.set(part.key, (added.get(part.key) ?? 0) + amount);
    placed += amount;
  };
  if (newMoney) {
    place(roth, newMoney.employeeRoth);
    place(preTax, newMoney.employeePreTax);
    place(afterTax, newMoney.employeeOther);
    place(matchRoth, newMoney.employerRoth);
    place(matchPreTax, newMoney.employer - newMoney.employerRoth);
  }

  const weightOf = (p: SnapshotSub) =>
    Math.max(p.amount, 0) + (added.get(p.key) ?? 0);
  const weight = parts.reduce((t, p) => t + weightOf(p), 0);
  const amounts = new Map<string, number>();
  let left = roundToCents(total);
  parts.forEach((p, i) => {
    const share = weight > 0 ? weightOf(p) / weight : 1 / parts.length;
    // The last part takes the rounding remainder.
    const amount = i === parts.length - 1 ? left : roundToCents(total * share);
    left = roundToCents(left - amount);
    amounts.set(p.key, amount);
  });
  return { amounts, placed: roundToCents(placed) };
}

export function suggestSnapshotAmounts(
  subs: readonly SnapshotSub[],
  feeds: readonly SnapshotFeed[],
  newMoneyFor: (performanceAccountId: number) => NewMoney | null = () => null,
  employerMatchSubTypeFor: (
    performanceAccountId: number,
  ) => string | null = () => null,
): SnapshotSuggestions {
  const amounts = new Map<string, number>();
  const notes = new Map<number, SnapshotAccountNote>();
  const accounts = new Set(subs.map((s) => s.performanceAccountId));
  for (const account of accounts) {
    const accountSubs = subs.filter((s) => s.performanceAccountId === account);
    const accountFeeds = feeds.filter(
      (f) => f.performanceAccountId === account,
    );
    // Sub-account links (a link to a sub-account no longer in the snapshot
    // is left out rather than guessed at).
    const linked: SnapshotFeed[] = [];
    for (const sub of accountSubs) {
      const mine = accountFeeds.filter((f) => f.subKey === sub.key);
      if (mine.length === 0) continue;
      linked.push(...mine);
      amounts.set(
        sub.key,
        roundToCents(mine.reduce((t, f) => t + f.balance, 0)),
      );
    }
    const whole = accountFeeds.filter((f) => f.subKey === null);
    const rest = accountSubs.filter((s) => !amounts.has(s.key));
    let split = false;
    let placed = 0;
    let newMoney: NewMoney | null = null;
    if (whole.length > 0 && rest.length > 0) {
      const total = whole.reduce((t, f) => t + f.balance, 0);
      split = rest.length > 1;
      newMoney = split ? newMoneyFor(account) : null;
      const r = splitAccountBalance(
        rest,
        total,
        newMoney,
        employerMatchSubTypeFor(account),
      );
      for (const [k, v] of r.amounts) amounts.set(k, v);
      placed = r.placed;
      linked.push(...whole);
    }
    if (linked.length === 0) continue;
    notes.set(account, {
      total: roundToCents(linked.reduce((t, f) => t + f.balance, 0)),
      balanceDate: earliest(linked.map((f) => f.balanceDate)),
      split,
      newMoney: placed,
      newMoneyEstimated: placed !== 0 && (newMoney?.estimated ?? false),
    });
  }
  return { amounts, accounts: notes };
}
