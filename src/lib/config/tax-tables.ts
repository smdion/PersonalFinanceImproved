// The LTCG bracket table's shape. The brackets themselves are yearly data
// (tax-data/us-federal/ → `ltcg_brackets`), passed in by the caller; the
// tax math on them is in lib/pure/tax/ltcg.ts.

/** LTCG brackets by filing status, as stored (`ltcg_brackets`): each
 *  threshold is that bracket's ceiling; `null` is the open top bracket. */
export type LtcgBracketTable = Record<
  string,
  { threshold: number | null; rate: number }[]
>;
