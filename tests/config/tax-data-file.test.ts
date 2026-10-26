/**
 * The tax-data file (tax-data/us-federal.json) — what CI checks on every
 * change to it, so a mistyped or uncited figure never reaches an install.
 * The checks live in lib/tax-data/validate.ts (the app runs them on a
 * community update too).
 */
import { describe, it, expect } from "vitest";
import { readTaxData } from "../helpers/tax-data";
import {
  unknownTaxDataKeys,
  validateTaxDataFile,
  withKnownKeysOnly,
} from "@/lib/tax-data/validate";
import { irmaaBracketsSchema, ltcgBracketsSchema } from "@/lib/db/json-schemas";

const file = readTaxData();

describe("tax-data file", () => {
  it("passes every check (lib/tax-data/validate.ts — the app runs the same on a community update)", () => {
    expect(validateTaxDataFile(file)).toEqual([]);
  });

  it("the dataVersion is a positive integer", () => {
    expect(Number.isInteger(file.dataVersion)).toBe(true);
    expect(file.dataVersion).toBeGreaterThan(0);
  });
});

describe("validateTaxDataFile catches", () => {
  const clone = () => JSON.parse(JSON.stringify(file)) as typeof file;
  const latest = (f: typeof file) =>
    f.years[String(Math.max(...Object.keys(f.years).map(Number)))]!;

  it("an unknown key (or ignores it when asked)", () => {
    const f = clone();
    latest(f).limits.made_up_limit = { value: 1, source: "x" };
    expect(validateTaxDataFile(f).join()).toMatch(
      /unknown key .*made_up_limit/,
    );
    expect(validateTaxDataFile(f, { unknownKeys: "ignore" })).toEqual([]);
    expect(unknownTaxDataKeys(withKnownKeysOnly(f))).toEqual([]);
  });

  it("a missing citation, a dropped key, an out-of-bounds jump", () => {
    const f = clone();
    const l = latest(f).limits;
    l.ira_limit = { ...l.ira_limit!, source: " " };
    expect(validateTaxDataFile(f).join()).toMatch(/ira_limit: no source/);
    const g = clone();
    delete latest(g).limits.ss_wage_base;
    expect(validateTaxDataFile(g).join()).toMatch(/dropped ss_wage_base/);
    const h = clone();
    latest(h).limits.ss_wage_base!.value *= 2;
    expect(validateTaxDataFile(h).join()).toMatch(
      /ss_wage_base: .* \(indexed\)/,
    );
  });

  it("brackets out of shape and a withholding table that doesn't add up", () => {
    const f = clone();
    latest(f).ltcg!.brackets.MFJ = [{ threshold: 100, rate: 0 }];
    expect(validateTaxDataFile(f).join()).toMatch(
      /ltcg MFJ: brackets out of shape/,
    );
    const g = clone();
    const rows = latest(g).withholding.tables.MFJ!.standard as {
      baseWithholding: number;
    }[];
    rows[2]!.baseWithholding += 100;
    expect(validateTaxDataFile(g).join()).toMatch(/withholding MFJ standard/);
  });

  it("a newer format", () => {
    const f = clone();
    f.formatVersion = 99;
    expect(validateTaxDataFile(f).join()).toMatch(/format 99/);
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
