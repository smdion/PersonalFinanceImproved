/**
 * The shipped tax data (`tax-data/us-federal/<year>.json`) against the
 * figures as published, hand-keyed and cited in
 * `tests/fixtures/irs-published/<year>.ts`: every cell of every table, for
 * each shipped filing status and year. A wrong figure fails here even when
 * it's consistent with its neighbours (a whole Single table shifted by
 * $500, one changed LTCG threshold), which no derived or structural test
 * can catch.
 *
 * A shipped year with no published fixture fails, so a new year's figures
 * are always checked: `pnpm tax-data:new-year` writes the blank fixture,
 * which is filled in from the notices and added to `PUBLISHED` below.
 *
 * Cases: answer key § Tax "Tables against the published figures"
 * (TAB-2025-*, TAB-2026-*, WH-2026-*; WH-2025-* added, since the item
 * covers every year). TAB-VAL, the validator rule, is in
 * tests/config/tax-data-file.test.ts. The IRMAA and poverty-guideline
 * cells are the data checks behind retirement I1-I13, I15 and I21
 * (Retirement "Data tests per shipped table"; those cases are written
 * with the IRMAA and ACA functions).
 */
import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { readTaxData } from "../helpers/tax-data";
import { toTaxableIncomeBrackets } from "@/lib/calculators/tax-brackets";
import type { TaxDataYear } from "@/lib/db/reference-reconcile-core";
import { PUBLISHED_2025 } from "../fixtures/irs-published/2025";
import { PUBLISHED_2026 } from "../fixtures/irs-published/2026";
import type {
  FilingStatus,
  PublishedYear,
  WithholdingRow,
} from "../fixtures/irs-published/types";

/** Every hand-keyed year. A new one is added here once it's filled in. */
const PUBLISHED: Readonly<Record<string, PublishedYear>> = {
  2025: PUBLISHED_2025,
  2026: PUBLISHED_2026,
};

const FIXTURE_DIR = path.resolve(__dirname, "../fixtures/irs-published");
const shipped = readTaxData();
const STATUSES: readonly FilingStatus[] = ["Single", "MFJ", "HOH"];
const SHORT: Record<FilingStatus, string> = {
  Single: "S",
  MFJ: "MFJ",
  HOH: "HOH",
};

/** The CMS IRMAA column each status reads: "Beneficiaries who file
 *  individual tax returns" (Single, HOH) or "joint tax returns" (MFJ).
 *  CMS fact sheets 2025, 2026; 20 CFR § 418.1115. */
const IRMAA_COLUMN: Record<FilingStatus, "individual" | "joint"> = {
  Single: "individual",
  MFJ: "joint",
  HOH: "individual",
};

/** Long-term gains rates, fixed by law: IRC § 1(h)(1)(B), (C), (D). */
const LTCG_RATES = [0, 0.15, 0.2] as const;

const year = (y: string): TaxDataYear => {
  const d = shipped.years[y];
  if (!d) throw new Error(`tax-data has no ${y}`);
  return d;
};

/** A shipped withholding table in the fixture's column names. */
const shippedRows = (d: TaxDataYear, st: FilingStatus, kind: string) =>
  (
    d.withholding.tables[st]![kind as "standard" | "checkbox"] as {
      threshold: number;
      baseWithholding: number;
      rate: number;
    }[]
  ).map((r): WithholdingRow => ({
    atLeast: r.threshold,
    tentative: r.baseWithholding,
    rate: r.rate,
  }));

/** Paths to every blank figure (`NaN`) or empty citation in a fixture. */
function blanks(v: unknown, at = ""): string[] {
  if (typeof v === "number") return Number.isNaN(v) ? [at] : [];
  if (Array.isArray(v)) return v.flatMap((x, i) => blanks(x, `${at}[${i}]`));
  if (v && typeof v === "object")
    return Object.entries(v).flatMap(([k, x]) =>
      k === "cite" && (typeof x !== "string" || !x.trim())
        ? [`${at}.cite`]
        : blanks(x, `${at}.${k}`),
    );
  return [];
}

describe("published tax figures: coverage", () => {
  it("every shipped year has a hand-keyed fixture (pnpm tax-data:new-year writes it)", () => {
    const missing = Object.keys(shipped.years).filter((y) => !PUBLISHED[y]);
    expect(
      missing,
      `no tests/fixtures/irs-published/<year>.ts in PUBLISHED for ${missing.join(", ")}: fill it in from the notices and add it here`,
    ).toEqual([]);
  });

  it("every fixture file is in PUBLISHED, under its own year", () => {
    const files = fs
      .readdirSync(FIXTURE_DIR)
      .map((f) => /^(\d{4})\.ts$/.exec(f)?.[1])
      .filter((y): y is string => !!y)
      .sort();
    expect(files).toEqual(Object.keys(PUBLISHED).sort());
    for (const [y, p] of Object.entries(PUBLISHED)) expect(p.year).toBe(+y);
  });

  it("every fixture figure is filled in and cited", () => {
    const bad = Object.entries(PUBLISHED).flatMap(([y, p]) =>
      blanks(p).map((b) => `${y}${b}`),
    );
    expect(
      bad.length,
      `${bad.length} blank figure(s) or citation(s), e.g. ${bad.slice(0, 5).join(", ")}`,
    ).toBe(0);
  });

  // The two publications are keyed separately, so they check each other:
  // each STANDARD table is the rate table shifted up by its first taxed
  // amount (T25 / T26 § 1 against RP24 § 2.01 / RP25 § 4.01).
  it.each(Object.keys(PUBLISHED))(
    "%s: each Pub 15-T STANDARD table is the Rev. Proc. rate table, shifted",
    (y) => {
      const p = PUBLISHED[y]!;
      for (const st of STATUSES) {
        const [, first, ...rest] = p.withholding[st].standard.value;
        const shift = first!.atLeast;
        expect(
          [first!, ...rest].map((r) => ({
            over: r.atLeast - shift,
            baseTax: r.tentative,
            rate: r.rate,
          })),
          `${y} ${st}`,
        ).toEqual(p.rateSchedule[st].value);
      }
    },
  );
});

for (const [y, p] of Object.entries(PUBLISHED)) {
  describe(`${y} shipped tables against the publications`, () => {
    for (const st of STATUSES) {
      const id = `tax/TAB-${y}-${SHORT[st]}`;

      // The 1040 brackets Ledgr taxes with are rebuilt from the STANDARD
      // withholding table (toTaxableIncomeBrackets); its base column is
      // the rate table's base tax.
      it(`${id}:brackets [TAX-05] ${st} bands and base tax = ${p.rateSchedule[st].cite}`, () => {
        const rows = shippedRows(year(y), st, "standard");
        const derived = toTaxableIncomeBrackets(
          rows.map((r, i) => ({
            min: r.atLeast,
            max: rows[i + 1]?.atLeast ?? null,
            rate: r.rate,
          })),
        );
        const want = p.rateSchedule[st].value;
        expect(derived).toEqual(
          want.map((r, i) => ({
            min: r.over,
            max: want[i + 1]?.over ?? null,
            rate: r.rate,
          })),
        );
        expect(rows.filter((r) => r.rate > 0).map((r) => r.tentative)).toEqual(
          want.map((r) => r.baseTax),
        );
      });

      it(`${id}:std [TAX-03] ${st} standard deduction = ${p.standardDeduction[st].cite}`, () => {
        const key = `standard_deduction_${st.toLowerCase()}`;
        expect(year(y).limits[key]?.value).toBe(p.standardDeduction[st].value);
      });

      it(`${id}:ltcg [TAX-19] ${st} 0% and 15% tops = ${p.ltcg[st].cite}`, () => {
        const { zeroRateTop, fifteenRateTop } = p.ltcg[st].value;
        expect(year(y).ltcg?.brackets[st]).toEqual(
          [zeroRateTop, fifteenRateTop, null].map((threshold, i) => ({
            threshold,
            rate: LTCG_RATES[i],
          })),
        );
      });

      // § 63(f)(1), (3): the married amount is per spouse (MFJ); the
      // unmarried one is Single's and HOH's.
      const addOn = st === "MFJ" ? "married" : "unmarried";
      it(`${id}:addon [TAX-21] ${st} aged-or-blind add-on = ${p.agedOrBlind[addOn].cite}`, () => {
        expect(
          year(y).limits[`additional_std_deduction_65_${addOn}`]?.value,
        ).toBe(p.agedOrBlind[addOn].value);
      });

      it(`tax/WH-${y}-${SHORT[st]} [TAX-06] ${st} withholding, both columns, every row = Pub 15-T (${y})`, () => {
        for (const kind of ["standard", "checkbox"] as const)
          expect(shippedRows(year(y), st, kind), `${st} ${kind}`).toEqual(
            p.withholding[st][kind].value,
          );
      });
    }
  });

  describe(`${y} shipped retirement tables against the publications`, () => {
    for (const st of STATUSES) {
      const col = IRMAA_COLUMN[st];
      const tiers = p.irmaa[col];
      // Per person, a year: (Part B + Part D monthly adjustment) × 12,
      // to the cent (the shipped `notes` say so).
      it(`${y} IRMAA ${st}: every tier's MAGI and surcharge = ${tiers.cite} [RET-15]`, () => {
        expect(year(y).irmaa?.brackets[st]).toEqual(
          tiers.value.map((t) => ({
            magiThreshold: t.over,
            annualSurcharge: Math.round((t.partB + t.partD) * 12 * 100) / 100,
          })),
        );
      });
    }

    it(`${y} poverty guidelines, sizes 1-8 = ${p.fpl.cite} [RET-17]`, () => {
      expect(year(y).fpl?.amounts).toEqual(p.fpl.value);
    });
  });
}
