/**
 * Snapshots as stacked series, one per tracked account — the Portfolio
 * chart's by-account view. Pure.
 */

/** More accounts than this fold into "Other", so the stack stays readable. */
export const MAX_STACKED_ACCOUNTS = 8;

const OTHER = "other";

export type StackedSnapshot = {
  date: string;
  byAccount: readonly { key: string; label: string; amount: number }[];
};

/**
 * The accounts to stack (largest at their peak in `snapshots` first, at
 * most MAX_STACKED_ACCOUNTS, the rest as "Other") and one row per snapshot
 * with each account's amount under its key.
 */
export function stackedSeries(snapshots: readonly StackedSnapshot[]): {
  series: { key: string; label: string }[];
  rows: ({ date: string } & Record<string, number | string>)[];
} {
  const peak = new Map<string, { label: string; max: number }>();
  for (const s of snapshots)
    for (const a of s.byAccount) {
      const p = peak.get(a.key) ?? { label: a.label, max: 0 };
      p.max = Math.max(p.max, a.amount);
      peak.set(a.key, p);
    }
  const ranked = [...peak.entries()]
    .filter(([k, p]) => k !== OTHER && p.max > 0)
    .sort((x, y) => y[1].max - x[1].max);
  const kept = new Set(ranked.slice(0, MAX_STACKED_ACCOUNTS).map(([k]) => k));
  const needsOther =
    ranked.length > kept.size || (peak.get(OTHER)?.max ?? 0) > 0;
  const series = [
    ...ranked
      .filter(([k]) => kept.has(k))
      .map(([key, p]) => ({ key, label: p.label })),
    ...(needsOther ? [{ key: OTHER, label: "Other" }] : []),
  ];
  const rows = snapshots.map((s) => {
    const row: { date: string } & Record<string, number | string> = {
      date: s.date,
    };
    for (const { key } of series) row[key] = 0;
    for (const a of s.byAccount) {
      const k = kept.has(a.key) ? a.key : OTHER;
      row[k] = ((row[k] as number) ?? 0) + a.amount;
    }
    return row;
  });
  return { series, rows };
}
