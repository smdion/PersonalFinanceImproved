/**
 * derivePortfolioQuickLookStats — pure stats derivation for the Portfolio
 * Quick Look panel. Extracted from portfolio-quick-look.tsx (F6, v0.5.3) so
 * the component body shrinks and the stats logic is independently testable.
 *
 * Returns null when there are fewer than 2 snapshots (no change to derive).
 */

export type PortfolioSnapshot = {
  id: number;
  date: string;
  total: number;
};

export type PortfolioQuickLookStats = NonNullable<
  ReturnType<typeof derivePortfolioQuickLookStats>
>;

export function derivePortfolioQuickLookStats(
  snapshots: PortfolioSnapshot[],
  now: Date = new Date(),
): {
  ath: PortfolioSnapshot;
  athDistance: number;
  athDistancePct: number;
  isAtAth: boolean;
  biggestGainDollar: {
    date: string;
    delta: number;
    deltaPct: number;
    days: number;
  };
  biggestLossDollar: {
    date: string;
    delta: number;
    deltaPct: number;
    days: number;
  };
  biggestGainPct: {
    date: string;
    delta: number;
    deltaPct: number;
    days: number;
  };
  biggestLossPct: {
    date: string;
    delta: number;
    deltaPct: number;
    days: number;
  };
  sharpestGainDollar: {
    date: string;
    delta: number;
    deltaPct: number;
    days: number;
  };
  sharpestLossDollar: {
    date: string;
    delta: number;
    deltaPct: number;
    days: number;
  };
  sharpestGainPct: {
    date: string;
    delta: number;
    deltaPct: number;
    days: number;
  };
  sharpestLossPct: {
    date: string;
    delta: number;
    deltaPct: number;
    days: number;
  };
  ytdDelta: number;
  ytdPct: number;
  weekChange52: number | null;
  weekChange52Pct: number | null;
  streak: number;
  streakDir: "gain" | "loss" | null;
  avgDelta: number;
  avgDeltaPct: number;
  bestMonthDollar: [string, number];
  worstMonthDollar: [string, number];
  bestMonthPct: [string, number];
  worstMonthPct: [string, number];
  volatility: number;
  avgDays: number;
  allTimeGrowth: number;
  allTimeGrowthPct: number;
  totalSnapshots: number;
  firstDate: string;
} | null {
  if (snapshots.length < 2) return null;
  // ISO 8601 YYYY-MM-DD strings sort lexicographically = chronologically.
  const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
  const current = sorted[sorted.length - 1]!;
  const first = sorted[0]!;

  // All-time high
  const ath = sorted.reduce((best, s) => (s.total > best.total ? s : best));
  const athDistance = current.total - ath.total;
  const athDistancePct = ath.total > 0 ? (athDistance / ath.total) * 100 : 0;

  // Changes between consecutive snapshots
  const changes = sorted.slice(1).map((s, i) => {
    const prev = sorted[i]!;
    const delta = s.total - prev.total;
    const days = Math.round(
      (new Date(s.date).getTime() - new Date(prev.date).getTime()) / 86400000,
    );
    const periodReturn = prev.total > 0 ? delta / prev.total : 0;
    const deltaPct = periodReturn * 100;
    return { date: s.date, delta, deltaPct, days };
  });

  // Biggest gain / loss — $ mode uses raw delta, % mode uses raw %
  const biggestGainDollar = changes.reduce((best, c) =>
    c.delta > best.delta ? c : best,
  );
  const biggestLossDollar = changes.reduce((worst, c) =>
    c.delta < worst.delta ? c : worst,
  );
  const biggestGainPct = changes.reduce((best, c) =>
    c.deltaPct > best.deltaPct ? c : best,
  );
  const biggestLossPct = changes.reduce((worst, c) =>
    c.deltaPct < worst.deltaPct ? c : worst,
  );

  // Sharpest gain / loss — ranked by rate of change ($/day or %/day)
  const withRate = changes.filter((c) => c.days > 0);
  const sharpestGainDollar = withRate.reduce((best, c) =>
    c.delta / c.days > best.delta / best.days ? c : best,
  );
  const sharpestLossDollar = withRate.reduce((worst, c) =>
    c.delta / c.days < worst.delta / worst.days ? c : worst,
  );
  const sharpestGainPct = withRate.reduce((best, c) =>
    c.deltaPct / c.days > best.deltaPct / best.days ? c : best,
  );
  const sharpestLossPct = withRate.reduce((worst, c) =>
    c.deltaPct / c.days < worst.deltaPct / worst.days ? c : worst,
  );

  // YTD change
  const currentYear = now.getFullYear().toString();
  const firstOfYear =
    sorted.find((s) => s.date >= `${currentYear}-01-01`) ?? first;
  const ytdDelta = current.total - firstOfYear.total;
  const ytdPct =
    firstOfYear.total > 0
      ? ((current.total - firstOfYear.total) / firstOfYear.total) * 100
      : 0;

  // 52-week change
  const oneYearAgoDate = new Date(now);
  oneYearAgoDate.setFullYear(oneYearAgoDate.getFullYear() - 1);
  const oneYearAgoStr = oneYearAgoDate.toISOString().slice(0, 10);
  const yearAgoSnap = sorted.reduce<PortfolioSnapshot | null>((best, s) => {
    if (s.date > oneYearAgoStr) return best;
    return !best ||
      Math.abs(new Date(s.date).getTime() - new Date(oneYearAgoStr).getTime()) <
        Math.abs(
          new Date(best.date).getTime() - new Date(oneYearAgoStr).getTime(),
        )
      ? s
      : best;
  }, null);
  const weekChange52 = yearAgoSnap ? current.total - yearAgoSnap.total : null;
  const weekChange52Pct =
    yearAgoSnap && yearAgoSnap.total > 0
      ? ((current.total - yearAgoSnap.total) / yearAgoSnap.total) * 100
      : null;

  // Streak
  let streak = 0;
  let streakDir: "gain" | "loss" | null = null;
  for (let i = changes.length - 1; i >= 0; i--) {
    const dir = changes[i]!.delta >= 0 ? "gain" : "loss";
    if (streakDir === null) streakDir = dir;
    if (dir === streakDir) streak++;
    else break;
  }

  // Average change per snapshot period
  const avgDelta =
    changes.length > 0
      ? changes.reduce((s, c) => s + c.delta, 0) / changes.length
      : 0;
  const avgDeltaPct =
    changes.length > 0
      ? changes.reduce((s, c) => s + c.deltaPct, 0) / changes.length
      : 0;
  const avgDays =
    changes.length > 0
      ? changes.reduce((s, c) => s + c.days, 0) / changes.length
      : 7;

  // Best/worst month — separate picks for $ vs %
  const byMonthDollar = new Map<string, number>();
  const byMonthPct = new Map<string, number>();
  for (const c of changes) {
    const month = c.date.slice(0, 7);
    byMonthDollar.set(month, (byMonthDollar.get(month) ?? 0) + c.delta);
    byMonthPct.set(month, (byMonthPct.get(month) ?? 0) + c.deltaPct);
  }
  const monthsDollar = [...byMonthDollar.entries()] as [string, number][];
  const bestMonthDollar = monthsDollar.reduce(
    (best, [m, d]) => (d > best[1] ? [m, d] : best),
    monthsDollar[0] ?? ["", 0],
  ) as [string, number];
  const worstMonthDollar = monthsDollar.reduce(
    (worst, [m, d]) => (d < worst[1] ? [m, d] : worst),
    monthsDollar[0] ?? ["", 0],
  ) as [string, number];
  const monthsPctArr = [...byMonthPct.entries()] as [string, number][];
  const bestMonthPct = monthsPctArr.reduce(
    (best, [m, d]) => (d > best[1] ? [m, d] : best),
    monthsPctArr[0] ?? ["", 0],
  ) as [string, number];
  const worstMonthPct = monthsPctArr.reduce(
    (worst, [m, d]) => (d < worst[1] ? [m, d] : worst),
    monthsPctArr[0] ?? ["", 0],
  ) as [string, number];

  // Volatility — stdev of per-period % changes
  const mean = changes.reduce((s, c) => s + c.deltaPct, 0) / changes.length;
  const variance =
    changes.reduce((s, c) => s + (c.deltaPct - mean) ** 2, 0) / changes.length;
  const volatility = Math.sqrt(variance);

  // All-time growth vs first snapshot
  const allTimeGrowth = current.total - first.total;
  const allTimeGrowthPct =
    first.total > 0 ? ((current.total - first.total) / first.total) * 100 : 0;

  return {
    ath,
    athDistance,
    athDistancePct,
    isAtAth: Math.abs(athDistance) < 1,
    biggestGainDollar,
    biggestLossDollar,
    biggestGainPct,
    biggestLossPct,
    sharpestGainDollar,
    sharpestLossDollar,
    sharpestGainPct,
    sharpestLossPct,
    ytdDelta,
    ytdPct,
    weekChange52,
    weekChange52Pct,
    streak,
    streakDir,
    avgDelta,
    avgDeltaPct,
    bestMonthDollar,
    worstMonthDollar,
    bestMonthPct,
    worstMonthPct,
    volatility,
    avgDays,
    allTimeGrowth,
    allTimeGrowthPct,
    totalSnapshots: sorted.length,
    firstDate: first.date,
  };
}
