/**
 * Money Guy's "Always Be Buying" (ALWAYS_BUYING_RULE): months with a SimpleFIN
 * deposit (a month breaks only when every deposit-taking feed covered it, else
 * "unknown"), and down years where contributions held up against the year before.
 */
import { ALWAYS_BUYING_RULE } from "@/lib/config/milestones";

export type BuyingMonthState = "invested" | "notInvested" | "unknown";
export type BuyingMonth = { month: string; state: BuyingMonthState };

const monthOf = (day: string) => day.slice(0, 7);
function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** One counted feed's days. */
export type BuyingFeed = {
  /** Days a deposit posted into it. */
  contributionDays: readonly string[];
  /** Days it reported a balance. */
  reportDays: readonly string[];
};

/** Each whole month from the one after the first transaction through the
 *  last completed one before `today`. */
export function buyingMonths(args: {
  feeds: readonly BuyingFeed[];
  /** The first transaction day any counted feed sent (null: none). */
  firstTransactionDay: string | null;
  today: string;
}): BuyingMonth[] {
  if (!args.firstTransactionDay) return [];
  const invested = new Set(
    args.feeds.flatMap((f) => f.contributionDays.map(monthOf)),
  );
  // The feeds whose silence would hide a deposit: those that take them
  // (every feed, while none has yet).
  const depositing = args.feeds.filter((f) => f.contributionDays.length > 0);
  const watched = (depositing.length > 0 ? depositing : args.feeds).map((f) => {
    const reported = new Set(f.reportDays.map(monthOf));
    const last = f.reportDays.reduce((l, d) => (d > l ? d : l), "");
    // A month is covered once a report came after it ended.
    return (m: string) => monthOf(last) > m && reported.has(m);
  });
  const thisMonth = monthOf(args.today);
  const out: BuyingMonth[] = [];
  for (
    let m = nextMonth(monthOf(args.firstTransactionDay));
    m < thisMonth;
    m = nextMonth(m)
  ) {
    const covered = watched.length > 0 && watched.every((c) => c(m));
    out.push({
      month: m,
      state: invested.has(m) ? "invested" : covered ? "notInvested" : "unknown",
    });
  }
  return out;
}

export type DownYear = {
  year: number;
  /** The household's recorded investment gain that year (negative). */
  gain: number;
  /** The household's own contributions that year and the year before. */
  contributed: number;
  prior: number;
  heldUp: boolean;
};

/** Every year with a recorded loss and a year before it to compare with. */
export function downYears(
  byYear: ReadonlyMap<number, { employee: number; gain: number }>,
): DownYear[] {
  const out: DownYear[] = [];
  for (const year of [...byYear.keys()].sort((a, b) => a - b)) {
    const y = byYear.get(year)!;
    const prior = byYear.get(year - 1);
    if (y.gain >= 0 || !prior) continue;
    out.push({
      year,
      gain: y.gain,
      contributed: y.employee,
      prior: prior.employee,
      heldUp: y.employee >= ALWAYS_BUYING_RULE.heldUpShare * prior.employee,
    });
  }
  return out;
}

/** The latest `recentMonths` months SimpleFIN covered (unknown ones left out). */
export function recentCoveredMonths(months: readonly BuyingMonth[]) {
  return months
    .filter((m) => m.state !== "unknown")
    .slice(-ALWAYS_BUYING_RULE.recentMonths);
}
