/**
 * R43 — resolveTaxParams parity / behaviour gate.
 *
 * This is the merge gate for the C4d/C4e wiring commits. It is not enough
 * to assert "engine-snapshot doesn't move" — that only exercises the case
 * where the calendar year, MAX(tax_brackets.taxYear) and the seeded
 * contribution_limits year are all the same, i.e. where every C4 change is
 * a no-op. The cases below cover the year-resolution edges C4 deliberately
 * changes.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  resolveTaxParams,
  type TaxParamsRowSets,
} from "@/lib/config/tax-params";

// ---------------------------------------------------------------------------
// Fixtures — parsed from the real seed so the parity check is against real
// data, not a hand-typed copy.
// ---------------------------------------------------------------------------

const SEED = fs.readFileSync(
  path.resolve(__dirname, "../../seed-reference-data.sql"),
  "utf8",
);

function parseLimits(): TaxParamsRowSets["contributionLimits"] {
  const out: TaxParamsRowSets["contributionLimits"] = [];
  const re = /\((\d{4}), '([a-z0-9_]+)', ([\d.]+),/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(SEED)) !== null) {
    out.push({ taxYear: Number(m[1]), limitType: m[2]!, value: m[3]! });
  }
  return out;
}

function parseWithholding(): TaxParamsRowSets["withholdingBrackets"] {
  const out: TaxParamsRowSets["withholdingBrackets"] = [];
  const re = /\((\d{4}), '(MFJ|Single|HOH)', (true|false), '(\[.*?\])'\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(SEED)) !== null) {
    out.push({
      taxYear: Number(m[1]),
      filingStatus: m[2]!,
      w4Checkbox: m[3] === "true",
      brackets: JSON.parse(m[4]!),
    });
  }
  return out;
}

function parseBracketMaps(
  needle: string,
): { taxYear: number; filingStatus: string; brackets: unknown[] }[] {
  const out: { taxYear: number; filingStatus: string; brackets: unknown[] }[] =
    [];
  const re = /\((\d{4}), '(MFJ|Single|HOH)', '(\[[^']*\])'\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(SEED)) !== null) {
    if (!m[3]!.includes(needle)) continue;
    out.push({
      taxYear: Number(m[1]),
      filingStatus: m[2]!,
      brackets: JSON.parse(m[3]!),
    });
  }
  return out;
}

function seedRows(overrides: Partial<TaxParamsRowSets> = {}): TaxParamsRowSets {
  return {
    vintage: [
      { taxYear: 2025, version: 1 },
      { taxYear: 2026, version: 1 },
    ],
    contributionLimits: parseLimits(),
    withholdingBrackets: parseWithholding(),
    ltcgBrackets: parseBracketMaps(
      "threshold",
    ) as TaxParamsRowSets["ltcgBrackets"],
    irmaaBrackets: parseBracketMaps(
      "magiThreshold",
    ) as TaxParamsRowSets["irmaaBrackets"],
    fpl: [
      { taxYear: 2025, amounts: { "1": 15650, "2": 21150 } },
      { taxYear: 2026, amounts: { "1": 15650, "2": 21150 } },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. All-2026 parity — the resolver must reproduce the pre-R43 4-table logic.
// ---------------------------------------------------------------------------

describe("resolveTaxParams — parity with pre-R43 resolution", () => {
  it("2026 (nearest) matches the MAX(tax_year) + filter logic", () => {
    const rows = seedRows();
    const r = resolveTaxParams(rows, 2026, { onMissing: "nearest" });

    // "today's" logic, inline:
    const latestBracketYear = Math.max(
      ...rows.withholdingBrackets.map((b) => b.taxYear),
    );
    expect(r.resolvedYear).toBe(latestBracketYear);

    const expectMfjFalse = rows.withholdingBrackets.find(
      (b) => b.taxYear === 2026 && b.filingStatus === "MFJ" && !b.w4Checkbox,
    )!.brackets;
    expect(r.withholdingBrackets!.MFJ.false).toEqual(expectMfjFalse);

    const expectLimits: Record<string, number> = {};
    for (const l of rows.contributionLimits)
      if (l.taxYear === 2026) expectLimits[l.limitType] = Number(l.value);
    expect(r.limits).toEqual(expectLimits);

    const latestLtcgYear = Math.max(...rows.ltcgBrackets.map((b) => b.taxYear));
    const expectLtcg = Object.fromEntries(
      rows.ltcgBrackets
        .filter((b) => b.taxYear === latestLtcgYear)
        .map((b) => [b.filingStatus, b.brackets]),
    );
    expect(r.ltcgByStatus).toEqual(expectLtcg);
  });

  it("no requestedYear => newest year, same as MAX(tax_year)", () => {
    const r = resolveTaxParams(seedRows());
    expect(r.resolvedYear).toBe(2026);
  });
});

// ---------------------------------------------------------------------------
// 2. Drift window — brackets seeded ahead of contribution_limits.
// ---------------------------------------------------------------------------

describe("resolveTaxParams — Oct-Jan drift window (F2-4)", () => {
  const rows = seedRows({
    // pretend 2027 withholding brackets landed but limits/ltcg/irmaa did not
    withholdingBrackets: [
      ...parseWithholding(),
      {
        taxYear: 2027,
        filingStatus: "MFJ",
        w4Checkbox: false,
        brackets: [
          { threshold: 0, baseWithholding: 0, rate: 0 },
          { threshold: 20000, baseWithholding: 0, rate: 0.1 },
        ],
      },
    ],
  });

  it("requesting 2026 stays entirely on 2026 (no split vintage)", () => {
    const r = resolveTaxParams(rows, 2026, { onMissing: "nearest" });
    expect(r.resolvedYear).toBe(2026);
    // brackets, limits, ltcg all come from 2026 — not 2027 brackets + 2026 limits
    expect(r.withholdingBrackets!.MFJ.false.length).toBe(8);
    expect(r.limits.standard_deduction_mfj).toBeGreaterThan(0);
  });

  it("requesting 2027 (nearest): brackets are 2027, everything else falls back to 2026", () => {
    const r = resolveTaxParams(rows, 2027, { onMissing: "nearest" });
    expect(r.resolvedYear).toBe(2027);
    // 2027 has withholding rows -> used
    expect(r.withholdingBrackets!.MFJ.false.length).toBe(2);
    // 2027 has no contribution_limits / ltcg / irmaa rows -> undefined / empty,
    // NOT silently the 2026 values. The engine's own `?? DEFAULT` handles the
    // bracket slices; C7 makes the limits map strict.
    expect(r.limits.standard_deduction_mfj).toBeUndefined();
    expect(r.ltcgByStatus).toBeUndefined();
    expect(r.irmaaByStatus).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. Missing-slice / missing-year contract.
// ---------------------------------------------------------------------------

describe("resolveTaxParams — onMissing contract", () => {
  it('onMissing "throw" rejects a year with no data', () => {
    expect(() =>
      resolveTaxParams(seedRows(), 2030, { onMissing: "throw" }),
    ).toThrow(/no tax data for year 2030/);
  });

  it('onMissing "nearest" resolves down to the newest earlier year', () => {
    const r = resolveTaxParams(seedRows(), 2030, { onMissing: "nearest" });
    expect(r.resolvedYear).toBe(2026);
  });

  it('onMissing "nearest" below all years resolves to the oldest', () => {
    const r = resolveTaxParams(seedRows(), 2000, { onMissing: "nearest" });
    expect(r.resolvedYear).toBe(2025);
  });

  it("throws when there is no reference data at all", () => {
    const empty: TaxParamsRowSets = {
      vintage: [],
      contributionLimits: [],
      withholdingBrackets: [],
      ltcgBrackets: [],
      irmaaBrackets: [],
      fpl: [],
    };
    expect(() => resolveTaxParams(empty, 2026)).toThrow(
      /no tax reference data/,
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Numeric type preservation — a decimal string must not round-trip lossily.
// ---------------------------------------------------------------------------

describe("resolveTaxParams — value fidelity", () => {
  it("keeps 0.062 exactly (string input, PG-style)", () => {
    const rows = seedRows({
      contributionLimits: [
        { taxYear: 2026, limitType: "fica_ss_rate", value: "0.062000" },
      ],
      withholdingBrackets: [
        {
          taxYear: 2026,
          filingStatus: "MFJ",
          w4Checkbox: false,
          brackets: [{ threshold: 0, baseWithholding: 0, rate: 0 }],
        },
      ],
    });
    const r = resolveTaxParams(rows, 2026);
    expect(r.limits.fica_ss_rate).toBe(0.062);
  });

  it("accepts numeric input unchanged (SQLite-style)", () => {
    const rows = seedRows({
      contributionLimits: [
        { taxYear: 2026, limitType: "fica_ss_rate", value: 0.062 },
      ],
      withholdingBrackets: [
        {
          taxYear: 2026,
          filingStatus: "MFJ",
          w4Checkbox: false,
          brackets: [{ threshold: 0, baseWithholding: 0, rate: 0 }],
        },
      ],
    });
    expect(resolveTaxParams(rows, 2026).limits.fica_ss_rate).toBe(0.062);
  });
});

// ---------------------------------------------------------------------------
// 5. LTCG top bracket — threshold: null must survive verbatim.
// ---------------------------------------------------------------------------

describe("resolveTaxParams — LTCG top bracket", () => {
  it("preserves threshold: null (never coerces to 0)", () => {
    const r = resolveTaxParams(seedRows(), 2026);
    const mfj = r.ltcgByStatus!.MFJ;
    expect(mfj[mfj.length - 1]!.threshold).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. Single vs HOH — both keys present even when equal.
// ---------------------------------------------------------------------------

describe("resolveTaxParams — filing-status keys", () => {
  it("keeps Single and HOH as distinct keys", () => {
    const r = resolveTaxParams(seedRows(), 2026);
    expect(Object.keys(r.irmaaByStatus!).sort()).toEqual([
      "HOH",
      "MFJ",
      "Single",
    ]);
    expect(r.withholdingBrackets!.HOH).toBeDefined();
    expect(r.withholdingBrackets!.Single).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 7. Synthetic 2027 — structural invariants for the first year the mechanism
//    is the real source in prod (no seed, no golden baseline for it).
// ---------------------------------------------------------------------------

describe("resolveTaxParams — synthetic future year structural invariants", () => {
  const synthetic2027 = seedRows({
    vintage: [{ taxYear: 2027, version: 1 }],
    contributionLimits: parseLimits()
      .filter((l) => l.taxYear === 2026)
      .map((l) => ({ ...l, taxYear: 2027 })),
    withholdingBrackets: parseWithholding()
      .filter((b) => b.taxYear === 2026)
      .map((b) => ({ ...b, taxYear: 2027 })),
    ltcgBrackets: (
      parseBracketMaps("threshold") as TaxParamsRowSets["ltcgBrackets"]
    )
      .filter((b) => b.taxYear === 2026)
      .map((b) => ({ ...b, taxYear: 2027 })),
    irmaaBrackets: (
      parseBracketMaps("magiThreshold") as TaxParamsRowSets["irmaaBrackets"]
    )
      .filter((b) => b.taxYear === 2026)
      .map((b) => ({ ...b, taxYear: 2027 })),
    fpl: [{ taxYear: 2027, amounts: { "1": 16000 } }],
  });

  const r = resolveTaxParams(synthetic2027, 2027, { onMissing: "throw" });

  it("resolves to 2027", () => {
    expect(r.resolvedYear).toBe(2027);
  });

  it("every withholding row: 7 statutory rates in order", () => {
    for (const fs of ["MFJ", "Single", "HOH"] as const) {
      for (const cb of ["false", "true"] as const) {
        const b = r.withholdingBrackets![fs][cb];
        expect(b.map((x) => x.rate)).toEqual([
          0, 0.1, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37,
        ]);
      }
    }
  });

  it("every withholding row: thresholds strictly increase", () => {
    for (const fs of ["MFJ", "Single", "HOH"] as const) {
      const b = r.withholdingBrackets![fs].false;
      for (let i = 1; i < b.length; i++) {
        expect(b[i]!.threshold).toBeGreaterThan(b[i - 1]!.threshold);
      }
    }
  });

  it("every withholding row: baseWithholding forward-cascade holds", () => {
    for (const fs of ["MFJ", "Single", "HOH"] as const) {
      const b = r.withholdingBrackets![fs].false;
      for (let i = 1; i < b.length; i++) {
        const expected =
          b[i - 1]!.baseWithholding +
          b[i - 1]!.rate * (b[i]!.threshold - b[i - 1]!.threshold);
        expect(Math.abs(b[i]!.baseWithholding - expected)).toBeLessThan(0.5);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 8. No vintage rows — old-backup restore path.
// ---------------------------------------------------------------------------

describe("resolveTaxParams — no tax_params rows (old-backup restore)", () => {
  it("resolves off the value tables' own MAX(tax_year), version 0", () => {
    const rows = seedRows({ vintage: [] });
    const r = resolveTaxParams(rows);
    expect(r.resolvedYear).toBe(2026);
    expect(r.version).toBe(0);
    // identical assembled output to the with-vintage case
    const withVintage = resolveTaxParams(seedRows());
    expect(r.limits).toEqual(withVintage.limits);
    expect(r.withholdingBrackets).toEqual(withVintage.withholdingBrackets);
  });
});
