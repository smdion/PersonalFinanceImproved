/**
 * Suggested portfolio snapshot balances from linked SimpleFIN accounts.
 * Pure; suggestions only — the household confirms the snapshot.
 *
 * A sub-account linked on its own takes its feed's balance. A feed linked
 * to the whole tracked account covers that account's other sub-accounts:
 * with one left it's exact, with several it's divided by their shares of
 * the last snapshot and labelled as estimated (a feed reports one balance,
 * not the Roth / pre-tax parts inside it).
 */
import { roundToCents } from "@/lib/utils/math";

export type SnapshotSub = {
  key: string;
  performanceAccountId: number;
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

export type SnapshotSuggestion = {
  amount: number;
  source: "linked" | "estimated";
  balanceDate: string | null;
};

const earliest = (days: (string | null)[]) =>
  days.includes(null) ? null : ([...days].sort()[0] ?? null);

export function suggestSnapshotAmounts(
  subs: readonly SnapshotSub[],
  feeds: readonly SnapshotFeed[],
): Map<string, SnapshotSuggestion> {
  const out = new Map<string, SnapshotSuggestion>();
  const accounts = new Set(subs.map((s) => s.performanceAccountId));
  for (const account of accounts) {
    const accountSubs = subs.filter((s) => s.performanceAccountId === account);
    const accountFeeds = feeds.filter(
      (f) => f.performanceAccountId === account,
    );
    // Sub-account links (a link to a sub-account no longer in the snapshot
    // is left out rather than guessed at).
    for (const sub of accountSubs) {
      const mine = accountFeeds.filter((f) => f.subKey === sub.key);
      if (mine.length === 0) continue;
      out.set(sub.key, {
        amount: roundToCents(mine.reduce((t, f) => t + f.balance, 0)),
        source: "linked",
        balanceDate: earliest(mine.map((f) => f.balanceDate)),
      });
    }
    const whole = accountFeeds.filter((f) => f.subKey === null);
    if (whole.length === 0) continue;
    const rest = accountSubs.filter((s) => !out.has(s.key));
    if (rest.length === 0) continue;
    const total = whole.reduce((t, f) => t + f.balance, 0);
    const balanceDate = earliest(whole.map((f) => f.balanceDate));
    const base = rest.reduce((t, s) => t + Math.max(s.amount, 0), 0);
    let left = roundToCents(total);
    rest.forEach((s, i) => {
      // The last part takes the rounding remainder so parts sum exactly.
      const amount =
        i === rest.length - 1
          ? left
          : roundToCents(
              base > 0
                ? (total * Math.max(s.amount, 0)) / base
                : total / rest.length,
            );
      left = roundToCents(left - amount);
      out.set(s.key, {
        amount,
        source: rest.length === 1 ? "linked" : "estimated",
        balanceDate,
      });
    });
  }
  return out;
}
