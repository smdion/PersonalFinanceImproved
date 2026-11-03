/**
 * The shape of a year's published tax figures (`tests/fixtures/irs-published/<year>.ts`),
 * hand-keyed from the notices and compared to the shipped
 * `tax-data/us-federal/<year>.json` by `tests/tax-data/irs-published.test.ts`.
 *
 * Every figure is typed in from the publication itself, never copied from
 * the shipped file or read from `src/`, and carries its citation
 * (publication, section or table, page). `pnpm tax-data:new-year` writes a
 * blank one (every figure `NaN`, every citation empty) to fill in.
 */

/** The filing statuses Ledgr ships tables for. */
export type FilingStatus = "Single" | "MFJ" | "HOH";

/** A published figure (or table) and where it's printed. */
export interface Cited<T> {
  readonly value: T;
  /** Publication, section or table, page. */
  readonly cite: string;
}

/** One line of a Rev. Proc. § 1 rate table: "$`baseTax` plus `rate` of the
 *  excess over $`over`". */
export interface RateScheduleRow {
  readonly over: number;
  readonly baseTax: number;
  readonly rate: number;
}

/** One row of a Pub 15-T annual percentage-method table: column A ("at
 *  least"), C (tentative amount to withhold) and D (percentage). Column B
 *  is the next row's A; column E equals A. */
export interface WithholdingRow {
  readonly atLeast: number;
  readonly tentative: number;
  readonly rate: number;
}

export interface PublishedYear {
  readonly year: number;
  /** The § 1 rate tables, from the first (10%) band to the 37% band. */
  readonly rateSchedule: Readonly<
    Record<FilingStatus, Cited<RateScheduleRow[]>>
  >;
  /** § 63(c)(2) basic standard deduction. */
  readonly standardDeduction: Readonly<Record<FilingStatus, Cited<number>>>;
  /** § 63(f) additional amount per box (aged or blind): married (MFJ, MFS,
   *  QSS) and unmarried (Single, HOH). */
  readonly agedOrBlind: {
    readonly married: Cited<number>;
    readonly unmarried: Cited<number>;
  };
  /** § 1(h) maximum zero-rate and 15%-rate amounts (taxable income). */
  readonly ltcg: Readonly<
    Record<FilingStatus, Cited<{ zeroRateTop: number; fifteenRateTop: number }>>
  >;
  /** Pub 15-T annual percentage-method tables: STANDARD and Step 2 checkbox. */
  readonly withholding: Readonly<
    Record<
      FilingStatus,
      {
        readonly standard: Cited<WithholdingRow[]>;
        readonly checkbox: Cited<WithholdingRow[]>;
      }
    >
  >;
}
