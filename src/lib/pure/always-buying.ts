/**
 * Money Guy's "Always Be Buying" (config ALWAYS_BUYING_RULE), from two
 * sources:
 * - months: whether SimpleFIN saw a deposit into a counted feed. A month
 *   counts only when the feeds covered all of it — the first, partial
 *   month, months after the latest report and months no feed reported are
 *   "unknown" and never break the streak.
 * - down years: in each finalized year the household's investments lost
 *   money, whether its own contributions held up against the year before.
 */
import { ALWAYS_BUYING_RULE } from "@/lib/config/milestones";

export type BuyingMonthState = "invested" | "notInvested" | "unknown";
export type BuyingMonth = { month: string; state: BuyingMonthState };

const monthOf = (day: string) => day.slice(0, 7);
function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** Each whole month from the one after the first transaction through the
 *  last completed one before `today`. */
export function buyingMonths(args: {
  /** Days a deposit posted into a counted feed. */
  contributionDays: readonly string[];
  /** Days any counted feed reported a balance. */
  reportDays: readonly string[];
  /** The first transaction day any counted feed sent (null: none). */
  firstTransactionDay: string | null;
  today: string;
}): BuyingMonth[] {
  if (!args.firstTransactionDay) return [];
  const invested = new Set(args.contributionDays.map(monthOf));
  const reported = new Set(args.reportDays.map(monthOf));
  const lastReport = args.reportDays.reduce(
    (latest, d) => (d > latest ? d : latest),
    "",
  );
  const thisMonth = monthOf(args.today);
  const out: BuyingMonth[] = [];
  for (
    let m = nextMonth(monthOf(args.firstTransactionDay));
    m < thisMonth;
    m = nextMonth(m)
  ) {
    // A month is covered once a report came after it ended.
    const covered = monthOf(lastReport) > m && reported.has(m);
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
