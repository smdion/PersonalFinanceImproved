/**
 * The tax-data file (tax-data/us-federal.json) — what CI checks on every
 * change to it, so a mistyped or uncited figure never reaches an install.
 */
import { describe, it, expect } from "vitest";
import { readTaxData } from "../helpers/tax-data";
import { TAX_DATA_FORMAT_VERSION } from "@/lib/db/reference-reconcile-core";
import { TAX_LIMIT_KEYS, taxLimitKey } from "@/lib/config/tax-limit-keys";
import { REQUIRED_FILING_STATUSES } from "@/lib/config/tax-params";
import {
  fplByHouseholdAmountsSchema,
  irmaaBracketsSchema,
  ltcgBracketsSchema,
} from "@/lib/db/json-schemas";

const file = readTaxData();
const years = Object.keys(file.years)
  .map(Number)
  .sort((a, b) => a - b);
const pairs = years.slice(1).map((y, i) => [years[i]!, y] as const);

/** Indexed dollar figures may move −2%…+15% a year. */
const INDEXED_BOUNDS = [0.98, 1.15] as const;
const within = (prev: number, next: number) =>
  prev === 0 ||
  (next / prev >= INDEXED_BOUNDS[0] && next / prev <= INDEXED_BOUNDS[1]);

describe("tax-data file", () => {
  it("is a format this app reads, with a positive data version", () => {
    expect(file.formatVersion).toBe(TAX_DATA_FORMAT_VERSION);
    expect(Number.isInteger(file.dataVersion)).toBe(true);
    expect(file.dataVersion).toBeGreaterThan(0);
  });

  it("uses only keys Ledgr knows (lib/config/tax-limit-keys.ts)", () => {
    const unknown = years.flatMap((y) =>
      Object.keys(file.years[y]!.limits).filter((k) => !taxLimitKey(k)),
    );
    expect(unknown).toEqual([]);
  });

  it("the latest year ships every key Ledgr knows", () => {
    const latest = file.years[years[years.length - 1]!]!.limits;
    expect(
      TAX_LIMIT_KEYS.map((k) => k.key).filter((k) => !(k in latest)),
    ).toEqual([]);
  });

  it("cites a source for every year, section and figure", () => {
    const missing: string[] = [];
    for (const y of years) {
      const d = file.years[y]!;
      if (!d.source?.trim()) missing.push(`${y}`);
      for (const [k, l] of Object.entries(d.limits))
        if (!l.source?.trim()) missing.push(`${y} ${k}`);
      for (const s of ["withholding", "ltcg", "irmaa", "fpl"] as const) {
        const sec = d[s];
        if (sec && !sec.source?.trim()) missing.push(`${y} ${s}`);
        if (sec?.exception && !(sec.exception.reason && sec.exception.source))
          missing.push(`${y} ${s} exception`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("every year has every filing status in every table it has", () => {
    for (const y of years) {
      const d = file.years[y]!;
      expect(
        Object.keys(d.withholding.tables).sort(),
        `${y} withholding`,
      ).toEqual([...REQUIRED_FILING_STATUSES].sort());
      for (const s of ["ltcg", "irmaa"] as const)
        if (d[s])
          expect(Object.keys(d[s]!.brackets).sort(), `${y} ${s}`).toEqual(
            [...REQUIRED_FILING_STATUSES].sort(),
          );
    }
  });

  it("brackets have the shape the tax math relies on (the Settings write schemas)", () => {
    for (const y of years) {
      const d = file.years[y]!;
      for (const [st, b] of Object.entries(d.ltcg?.brackets ?? {}))
        expect(ltcgBracketsSchema.safeParse(b).success, `${y} ltcg ${st}`).toBe(
          true,
        );
      for (const [st, b] of Object.entries(d.irmaa?.brackets ?? {}))
        expect(
          irmaaBracketsSchema.safeParse(b).success,
          `${y} irmaa ${st}`,
        ).toBe(true);
      if (d.fpl)
        expect(
          fplByHouseholdAmountsSchema.safeParse(d.fpl.amounts).success,
          `${y} fpl`,
        ).toBe(true);
    }
  });

  it("a year keeps every key the year before had (unless the law ended it)", () => {
    for (const [prev, next] of pairs) {
      const before = file.years[prev]!.limits;
      const after = file.years[next]!.limits;
      const sunset = before.obbba_senior_deduction_sunset_year?.value;
      const dropped = Object.keys(before).filter(
        (k) =>
          !(k in after) &&
          !(k.startsWith("obbba_") && sunset !== undefined && next > sunset),
      );
      expect(dropped, `${prev} → ${next}`).toEqual([]);
    }
  });

  it("figures move within bounds for their kind, unless an exception is cited", () => {
    const outOfBounds: string[] = [];
    for (const [prev, next] of pairs)
      for (const [k, l] of Object.entries(file.years[next]!.limits)) {
        const before = file.years[prev]!.limits[k]?.value;
        const kind = taxLimitKey(k)?.kind;
        if (before === undefined || !kind || l.exception) continue;
        const ok =
          kind === "indexed" ? within(before, l.value) : before === l.value;
        if (!ok)
          outOfBounds.push(`${next} ${k}: ${before} → ${l.value} (${kind})`);
      }
    expect(outOfBounds).toEqual([]);
  });

  it("bracket thresholds move within the indexed bounds, unless an exception is cited", () => {
    const outOfBounds: string[] = [];
    const check = (
      label: string,
      before: { threshold?: number | null }[],
      after: { threshold?: number | null }[],
    ) =>
      after.forEach((b, i) => {
        const p = before[i]?.threshold;
        if (p && b.threshold && !within(p, b.threshold))
          outOfBounds.push(`${label} row ${i}: ${p} → ${b.threshold}`);
      });
    for (const [prev, next] of pairs) {
      const a = file.years[prev]!;
      const b = file.years[next]!;
      if (!b.withholding.exception)
        for (const [st, t] of Object.entries(b.withholding.tables))
          for (const kind of ["standard", "checkbox"] as const)
            check(
              `${next} withholding ${st} ${kind}`,
              a.withholding.tables[st]?.[kind] as { threshold: number }[],
              t[kind] as { threshold: number }[],
            );
      for (const s of ["ltcg", "irmaa"] as const)
        if (a[s] && b[s] && !b[s]!.exception)
          for (const [st, br] of Object.entries(b[s]!.brackets))
            check(
              `${next} ${s} ${st}`,
              (a[s]!.brackets[st] ?? []) as { threshold?: number }[],
              (br as { magiThreshold?: number; threshold?: number }[]).map(
                (r) => ({ threshold: r.threshold ?? r.magiThreshold }),
              ),
            );
    }
    expect(outOfBounds).toEqual([]);
  });

  it("withholding tables add up: each row's base = the one before + its rate × the gap (within $1 — IRS rounds)", () => {
    const off: string[] = [];
    for (const y of years)
      for (const [st, t] of Object.entries(file.years[y]!.withholding.tables))
        for (const kind of ["standard", "checkbox"] as const) {
          const rows = t[kind] as {
            threshold: number;
            baseWithholding: number;
            rate: number;
          }[];
          rows.slice(1).forEach((r, i) => {
            const p = rows[i]!;
            const expected =
              p.baseWithholding + p.rate * (r.threshold - p.threshold);
            if (Math.abs(r.baseWithholding - expected) > 1)
              off.push(
                `${y} ${st} ${kind} @${r.threshold}: ${r.baseWithholding} vs ${expected.toFixed(2)}`,
              );
          });
        }
    expect(off).toEqual([]);
  });
});

describe("bracket write schemas", () => {
  const top = { threshold: null, rate: 0.2 };
  it("LTCG: open top, thresholds and rates never go down", () => {
    const ok = [
      { threshold: 100, rate: 0 },
      { threshold: 500, rate: 0.15 },
      top,
    ];
    expect(ltcgBracketsSchema.safeParse(ok).success).toBe(true);
    // The Settings placeholder: equal thresholds are fine.
    expect(
      ltcgBracketsSchema.safeParse([
        { threshold: 0, rate: 0 },
        { threshold: 0, rate: 0.15 },
        top,
      ]).success,
    ).toBe(true);
    for (const bad of [
      [],
      [{ threshold: 100, rate: 0 }], // no open top: gains above go untaxed
      [{ threshold: null, rate: 0 }, top], // open bracket before the end
      [{ threshold: 500, rate: 0 }, { threshold: 100, rate: 0.15 }, top],
      [{ threshold: 100, rate: 0.15 }, { threshold: 500, rate: 0 }, top],
      [{ threshold: 100, rate: 15 }, top], // a percent, not a rate
    ])
      expect(
        ltcgBracketsSchema.safeParse(bad).success,
        JSON.stringify(bad),
      ).toBe(false);
  });

  it("IRMAA: thresholds and surcharges never go down", () => {
    expect(
      irmaaBracketsSchema.safeParse([
        { magiThreshold: 100, annualSurcharge: 10 },
        { magiThreshold: 200, annualSurcharge: 20 },
      ]).success,
    ).toBe(true);
    for (const bad of [
      [],
      [
        { magiThreshold: 200, annualSurcharge: 10 },
        { magiThreshold: 100, annualSurcharge: 20 },
      ],
      [
        { magiThreshold: 100, annualSurcharge: 20 },
        { magiThreshold: 200, annualSurcharge: 10 },
      ],
    ])
      expect(irmaaBracketsSchema.safeParse(bad).success).toBe(false);
  });
});
