// Filing status: the status the tax return files as, and the W-4 Step 1(c) box (a withholding
// choice); they share three spellings, so each type carries a marker. Also: filing-status.schema.ts
// (Zod), lib/pure/tax/filing-status.ts (the chain), server/services/tax/filing-status.ts (this year).

export const RETURN_FILING_STATUS_VALUES = ["MFJ", "Single", "HOH"] as const;
/** A return status's spelling: tables keyed by return status (rules, labels) use it. */
export type ReturnFilingStatusSpelling =
  (typeof RETURN_FILING_STATUS_VALUES)[number];
/** The marker is optional, so a literal is either status, but a value
 *  typed W-4 is not a return status: w4StandInForReturn converts one. */
export type ReturnFilingStatus = ReturnFilingStatusSpelling & {
  readonly __filing?: "return";
};

/** A per-status tax table's row (tax data and the config tables are keyed by it); a return
 *  status reads one through its rules (`survivorRow`, `jointRow`). */
export type FilingStatusKey = "MFJ" | "Single" | "HOH";

export const W4_FILING_STATUS_VALUES = ["MFJ", "Single", "HOH"] as const;
export type W4FilingStatus = (typeof W4_FILING_STATUS_VALUES)[number] & {
  readonly __filing?: "w4";
};

export type FilingStatusRules = {
  /** People on the return: one, or both spouses on a joint return. */
  readonly peopleOnReturn: 1 | 2;
  /** Position in every list of return statuses (pickers). */
  readonly order: number;
  /** The tax-table row for the rules the statute writes "joint return or surviving spouse"
   *  (the basic standard deduction, LTCG, NIIT). */
  readonly survivorRow: FilingStatusKey;
  /** The row for the rules it writes for a joint return alone (Social Security's base
   *  amounts, the senior deduction's phase-out start, IRMAA). */
  readonly jointRow: FilingStatusKey;
  /** IRC 63(f)(3): married or a surviving spouse takes the lower 65+ add-on. */
  readonly marriedAddOn: boolean;
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
  },
  Single: {
    peopleOnReturn: 1,
    order: 1,
    survivorRow: "Single",
    jointRow: "Single",
    marriedAddOn: false,
  },
  HOH: {
    peopleOnReturn: 1,
    order: 2,
    survivorRow: "HOH",
    jointRow: "HOH",
    marriedAddOn: false,
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

/** A table keyed by return status (rules, labels): a status's entry, either kind. */
export function filingTable<V>(
  table: Readonly<Record<ReturnFilingStatusSpelling, V>>,
  status: ReturnFilingStatus | W4FilingStatus,
): V {
  const key: ReturnFilingStatusSpelling = status;
  return table[key];
}
