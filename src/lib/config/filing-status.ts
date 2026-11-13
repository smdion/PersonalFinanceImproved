// Filing status: the status the tax return files as, and the W-4 Step 1(c) box (a withholding
// choice); they share three spellings (the return adds QSS), so each type carries a marker. Also: filing-status.schema.ts
// (Zod), lib/pure/tax/filing-status.ts (the chain), server/services/tax/filing-status.ts (this year).

export const RETURN_FILING_STATUS_VALUES = [
  "MFJ",
  "Single",
  "HOH",
  "QSS",
] as const;
/** A return status's spelling: tables keyed by return status (rules, labels) use it. */
export type ReturnFilingStatusSpelling =
  (typeof RETURN_FILING_STATUS_VALUES)[number];
/** The marker is optional, so a literal is either status, but a value
 *  typed W-4 is not a return status: w4StandInForReturn converts one. */
export type ReturnFilingStatus = ReturnFilingStatusSpelling & {
  readonly __filing?: "return";
};

/** The rows every per-status tax table has (tax data and the config tables), in order; a
 *  return status reads one through its rules (`survivorRow`, `jointRow`). */
export const TAX_TABLE_ROWS = ["MFJ", "Single", "HOH"] as const;
/** A per-status tax table's row: tables are keyed by it. */
export type FilingStatusKey = (typeof TAX_TABLE_ROWS)[number];

export const W4_FILING_STATUS_VALUES = ["MFJ", "Single", "HOH"] as const;
export type W4FilingStatus = (typeof W4_FILING_STATUS_VALUES)[number] & {
  readonly __filing?: "w4";
};

export type FilingStatusRules = {
  /** People on the return: one, or both spouses on a joint return. */
  readonly peopleOnReturn: 1 | 2;
  /** Position in every list of return statuses (pickers). */
  readonly order: number;
  /** The tax-table row for the rules the statute writes "joint return or surviving spouse":
   *  the rate table and basic standard deduction, LTCG, NIIT, the Roth IRA range, the W-4 box. */
  readonly survivorRow: FilingStatusKey;
  /** The row for the rules it writes for a joint return alone (Social Security's base
   *  amounts, Additional Medicare, the senior deduction's phase-out start, IRMAA). */
  readonly jointRow: FilingStatusKey;
  /** IRC 63(f)(3): married or a surviving spouse takes the lower 65+ add-on. */
  readonly marriedAddOn: boolean;
  /** The fewest people in the return's ACA family (26 USC 36B(d)(1)): a joint return's two
   *  spouses; an HOH's or QSS's qualifying person makes two (IRC 2(a), 2(b)). */
  readonly minimumFamily: 1 | 2;
  /** The status the projection's years file as. QSS lasts the two years after the spouse's
   *  death (IRC 2(a)); with no death year, the projection takes the cautious Single. */
  readonly projectionStatus: ReturnFilingStatusSpelling;
};

/** One row per return status. */
export const FILING_STATUS_RULES: Readonly<
  Record<ReturnFilingStatusSpelling, FilingStatusRules>
> = {
  MFJ: {
    peopleOnReturn: 2,
    order: 0,
    survivorRow: "MFJ",
    jointRow: "MFJ",
    marriedAddOn: true,
    minimumFamily: 2,
    projectionStatus: "MFJ",
  },
  Single: {
    peopleOnReturn: 1,
    order: 1,
    survivorRow: "Single",
    jointRow: "Single",
    marriedAddOn: false,
    minimumFamily: 1,
    projectionStatus: "Single",
  },
  HOH: {
    peopleOnReturn: 1,
    order: 2,
    survivorRow: "HOH",
    jointRow: "HOH",
    marriedAddOn: false,
    minimumFamily: 2,
    projectionStatus: "HOH",
  },
  // Qualifying surviving spouse: one person on the return (IRC 2(a)).
  QSS: {
    peopleOnReturn: 1,
    order: 3,
    survivorRow: "MFJ",
    jointRow: "Single",
    marriedAddOn: true,
    minimumFamily: 2,
    projectionStatus: "Single",
  },
};

/** A return status's rules. */
export function filingRules(status: ReturnFilingStatus): FilingStatusRules {
  const key: ReturnFilingStatusSpelling = status;
  return FILING_STATUS_RULES[key];
}

/** A per-status tax table's entry for a rule written "joint return or surviving spouse". */
export function survivorTable<V>(
  table: Readonly<Record<FilingStatusKey, V>>,
  status: ReturnFilingStatus,
): V {
  return table[filingRules(status).survivorRow];
}

/** A per-status tax table's entry for a rule written for a joint return alone. */
export function jointTable<V>(
  table: Readonly<Record<FilingStatusKey, V>>,
  status: ReturnFilingStatus,
): V {
  return table[filingRules(status).jointRow];
}

/** The statuses a projection's years file as (QSS ends after two years), in `order`. */
export const PROJECTION_FILING_STATUSES: readonly ReturnFilingStatus[] =
  RETURN_FILING_STATUS_VALUES.filter(
    (s) => FILING_STATUS_RULES[s].projectionStatus === s,
  );

/** Every return status, in `order`. */
export const FILING_STATUS_ORDER: readonly ReturnFilingStatus[] = [
  ...RETURN_FILING_STATUS_VALUES,
].sort(
  (a, b) =>
    filingTable(FILING_STATUS_RULES, a).order -
    filingTable(FILING_STATUS_RULES, b).order,
);

/** A stored or sent value as a return status; null when it isn't one. */
export function parseReturnFilingStatus(
  value: unknown,
): ReturnFilingStatus | null {
  return RETURN_FILING_STATUS_VALUES.find((s) => s === value) ?? null;
}

/** The two spouses on a joint return of exactly two people; null otherwise (Ledgr stores no
 *  spouse link, so a third adult or a one-person joint return has no pair). */
export function spousePair<P>(
  status: ReturnFilingStatus | null | undefined,
  people: readonly P[],
): readonly [P, P] | null {
  if (status == null || filingRules(status).peopleOnReturn !== 2) return null;
  const [a, b] = people;
  return people.length === 2 && a !== undefined && b !== undefined
    ? [a, b]
    : null;
}

/** A table keyed by return status (rules, labels): a status's entry, either kind. */
export function filingTable<V>(
  table: Readonly<Record<ReturnFilingStatusSpelling, V>>,
  status: ReturnFilingStatus | W4FilingStatus,
): V {
  const key: ReturnFilingStatusSpelling = status;
  return table[key];
}
