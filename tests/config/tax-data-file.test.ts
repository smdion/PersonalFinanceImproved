/**
 * The tax data (tax-data/us-federal/, one file a year) — what CI checks on
 * every change to it, so a mistyped or uncited figure never reaches an
 * install.
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
import {
  assembleTaxData,
  readTaxDataDir,
} from "@/lib/db/reference-reconcile-core";
import { staleTaxDataFiles } from "../../scripts/tax-data-schema";

const file = readTaxData();

describe("tax-data file", () => {
  it("passes every check (lib/tax-data/validate.ts — the app runs the same on a community update)", () => {
    expect(validateTaxDataFile(file)).toEqual([]);
  });

  it("the generated schemas and README key table are current (pnpm tax-data:schema)", async () => {
    expect(await staleTaxDataFiles()).toEqual([]);
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
    latest(f).limits.made_up_limit = {
      value: 1,
      source: latest(f).limits.ira_limit!.source,
    };
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

  it("a citation with no link, a link nobody cites, a year with no sources", () => {
    const f = clone();
    latest(f).limits.ira_limit!.source = "Some Notice 2099-1";
    expect(validateTaxDataFile(f).join()).toMatch(
      /ira_limit: "Some Notice 2099-1" has no https link/,
    );
    const g = clone();
    latest(g).sources!["Unused Doc"] = "https://example.gov/x.pdf";
    expect(validateTaxDataFile(g).join()).toMatch(/"Unused Doc" isn't cited/);
    const h = clone();
    const first = Object.keys(latest(h).sources!)[0]!;
    latest(h).sources![first] = "http://insecure.example";
    expect(validateTaxDataFile(h).join()).toMatch(/has no https link/);
    const i = clone();
    delete latest(i).sources;
    expect(validateTaxDataFile(i).join()).toMatch(/no sources map/);
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

describe("assembleTaxData", () => {
  const index = {
    name: "index.json",
    text: '{"formatVersion":1,"dataVersion":3}',
  };
  const year = (y: string) => ({
    name: `${y}.json`,
    text: JSON.stringify({ $schema: "x", revision: 1, source: "s" }),
  });

  it("one file: years in order, editor $schema lines dropped", () => {
    const f = assembleTaxData([year("2026"), index, year("2025")]);
    expect(f.dataVersion).toBe(3);
    expect(Object.keys(f.years)).toEqual(["2025", "2026"]);
    expect(f.years["2025"]).not.toHaveProperty("$schema");
  });

  it("refuses a stray file and a missing index", () => {
    expect(() =>
      assembleTaxData([index, { name: "notes.json", text: "{}" }]),
    ).toThrow(/only index.json and YYYY.json/);
    expect(() => assembleTaxData([year("2025")])).toThrow(
      /index.json is missing/,
    );
  });

  it("at runtime, a stray file is ignored (a start must not fail on it)", () => {
    const fake = {
      readdirSync: () => ["index.json", "2025.json", "notes.json", "README.md"],
      readFileSync: (p: string) =>
        p.endsWith("index.json") ? index.text : year("2025").text,
    };
    expect(Object.keys(readTaxDataDir(fake, "x").years)).toEqual(["2025"]);
  });

  it("an install checking a community update doesn't refuse it over a citation", () => {
    const f = JSON.parse(JSON.stringify(file)) as typeof file;
    f.years["2026"]!.limits.ira_limit!.source = "Typo'd Notice";
    expect(validateTaxDataFile(f).join()).toMatch(/has no https link/);
    expect(
      validateTaxDataFile(f, { unknownKeys: "ignore", citations: "lenient" }),
    ).toEqual([]);
  });

  it("a blank year (pnpm tax-data:new-year) never passes", () => {
    const f = JSON.parse(JSON.stringify(file)) as typeof file;
    const last = f.years["2026"]!;
    const blank = (v: unknown): unknown =>
      typeof v === "number"
        ? null
        : Array.isArray(v)
          ? v.map(blank)
          : v && typeof v === "object"
            ? Object.fromEntries(
                Object.entries(v).map(([k, x]) => [k, blank(x)]),
              )
            : v;
    f.years["2027"] = {
      ...last,
      revision: 1,
      source: "",
      sources: {},
      limits: Object.fromEntries(
        Object.keys(last.limits).map((k) => [
          k,
          { value: null as never, source: "" },
        ]),
      ),
      withholding: {
        source: "",
        tables: blank(last.withholding.tables) as never,
      },
      ltcg: { source: "", brackets: blank(last.ltcg!.brackets) as never },
      irmaa: { source: "", brackets: blank(last.irmaa!.brackets) as never },
      fpl: { source: "", amounts: blank(last.fpl!.amounts) as never },
    };
    const problems = validateTaxDataFile(f).join("\n");
    expect(problems).toMatch(/2027 ira_limit: not a number/);
    expect(problems).toMatch(
      /2027 withholding MFJ standard row 0: threshold is blank/,
    );
    expect(problems).toMatch(/2027 ltcg MFJ: brackets out of shape/);
    expect(problems).toMatch(/2027 irmaa MFJ: brackets out of shape/);
    expect(problems).toMatch(/2027 fpl: needs sizes 1–8/);
    expect(problems).toMatch(/2027: no source/);
  });
});
