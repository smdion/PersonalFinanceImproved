/**
 * A chart's screen-reader text: a short name, and one sentence built only
 * from values the chart already plots, formatted as its tooltip shows them.
 */
export type ChartSummary = { label: string; text: string };

/** One plotted value as the chart shows it: a series or slice name and its value. */
export type ShownValue = readonly [name: string, value: string];

const listed = (values: readonly ShownValue[]) =>
  values.map(([name, value]) => `${name} ${value}`).join("; ");

/** A series over x: its first and last x, then the last point's values. */
export function seriesSummary(
  label: string,
  xs: readonly string[],
  last: readonly ShownValue[],
): ChartSummary {
  const first = xs[0];
  const end = xs.at(-1);
  if (first === undefined || end === undefined)
    return { label, text: `${label}: nothing plotted.` };
  const range = first === end ? first : `${first} to ${end}`;
  const values = last.length > 0 ? ` ${end}: ${listed(last)}.` : "";
  return { label, text: `${label}, ${range}.${values}` };
}

/** Bars by category or slices of a whole: each one's shown value. */
export function partsSummary(
  label: string,
  parts: readonly ShownValue[],
): ChartSummary {
  if (parts.length === 0) return { label, text: `${label}: nothing plotted.` };
  return { label, text: `${label}: ${listed(parts)}.` };
}
