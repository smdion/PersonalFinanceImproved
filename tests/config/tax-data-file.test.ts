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
  type Year = (typeof file)["years"][string];
  /** The poverty guidelines moved 3% (each size, whole dollars). */
  const moveFpl = (
    fpl: NonNullable<Year["fpl"]>,
  ): NonNullable<Year["fpl"]> => ({
    ...fpl,
    amounts: Object.fromEntries(
      Object.entries(fpl.amounts).map(([k, v]) => [k, Math.round(v * 1.03)]),
    ),
  });
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

  // Answer key TAB-VAL. Indexed tables move every year, so a new year
  // whose table equals the prior year's was copied and not updated (the
  // way the wrong IRMAA table once shipped). Tables only: a single limit
  // can repeat (the 401(k) limit was $16,500 in 2009, 2010 and 2011).
  it("tax/TAB-VAL [TAX-06] a next year whose indexed tables equal the prior year's, naming each table", () => {
    const f = clone();
    const prev = latest(f);
    const next = String(Math.max(...Object.keys(f.years).map(Number)) + 1);
    const from = Object.keys(f.years).sort().at(-1)!;
    f.years[next] = JSON.parse(JSON.stringify(prev)) as typeof prev;
    const problems = validateTaxDataFile(f);
    const copied = problems
      .filter((p) => p.includes(`the same table as ${from}'s`))
      .map((p) => p.split(":")[0]);
    expect(copied).toEqual([
      ...["MFJ", "Single", "HOH"].flatMap((st) =>
        ["standard", "checkbox"].map((k) => `${next} withholding ${st} ${k}`),
      ),
      ...["ltcg", "irmaa"].flatMap((s) =>
        ["MFJ", "Single", "HOH"].map((st) => `${next} ${s} ${st}`),
      ),
    ]);
    // The poverty guidelines too, as one table.
    expect(problems.map((p) => p.split(":")[0])).toContain(
      `${next} fpl amounts`,
    );
    // Nothing else is wrong with the copy, and no limit is named.
    expect(problems).toHaveLength(copied.length + 1);
    // The message tells a contributor what to do.
    expect(problems[0]).toMatch(
      new RegExp(
        `key it from the ${next} publication.*give ${next} withholding an exception`,
      ),
    );

    // The same year with every table moved 2% passes, though every limit
    // still equals the prior year's.
    const g = clone();
    const moved = JSON.parse(JSON.stringify(latest(g))) as typeof prev;
    const up = (r: Record<string, number | null>) => {
      for (const k of [
        "threshold",
        "magiThreshold",
        "baseWithholding",
        "annualSurcharge",
      ])
        if (typeof r[k] === "number") r[k] = r[k] * 1.02;
    };
    for (const t of Object.values(moved.withholding.tables))
      [...t.standard, ...t.checkbox].forEach((r) => up(r as never));
    for (const s of ["ltcg", "irmaa"] as const)
      for (const b of Object.values(moved[s]!.brackets))
        b.forEach((r) => up(r as never));
    moved.fpl = moveFpl(moved.fpl!);
    g.years[next] = moved;
    expect(validateTaxDataFile(g)).toEqual([]);

    // One status left unchanged is still caught, and an exception
    // (reason and source) is the way to ship a table that really repeats.
    const h = clone();
    const partly = JSON.parse(JSON.stringify(moved)) as typeof prev;
    partly.ltcg!.brackets.HOH = prev.ltcg!.brackets.HOH!;
    h.years[next] = partly;
    expect(validateTaxDataFile(h).map((p) => p.split(":")[0])).toEqual([
      `${next} ltcg HOH`,
    ]);
    partly.ltcg!.exception = {
      reason: "Published unchanged",
      source: prev.ltcg!.source,
    };
    expect(validateTaxDataFile(h)).toEqual([]);

    // IRMAA surcharges copied while the thresholds moved: caught on their
    // own (they follow the Part B premium, which moves every year).
    const k = clone();
    const surcharges = JSON.parse(JSON.stringify(moved)) as typeof prev;
    type Surcharged = { annualSurcharge: number };
    for (const [st, rows] of Object.entries(surcharges.irmaa!.brackets))
      (rows as Surcharged[]).forEach((r, i) => {
        r.annualSurcharge = (prev.irmaa!.brackets[st] as Surcharged[])[
          i
        ]!.annualSurcharge;
      });
    k.years[next] = surcharges;
    expect(validateTaxDataFile(k).map((p) => p.split(":")[0])).toEqual(
      ["MFJ", "Single", "HOH"].map((st) => `${next} irmaa ${st}`),
    );
    expect(validateTaxDataFile(k)[0]).toMatch(/the same surcharges as/);

    // A freeze: thresholds unchanged, surcharges moved, is no copy.
    const m = clone();
    const frozen = JSON.parse(JSON.stringify(prev)) as typeof prev;
    frozen.withholding = moved.withholding;
    frozen.ltcg = moved.ltcg;
    frozen.fpl = moved.fpl;
    for (const rows of Object.values(frozen.irmaa!.brackets))
      (rows as { annualSurcharge: number }[]).forEach((r) => {
        r.annualSurcharge = r.annualSurcharge * 1.02;
      });
    m.years[next] = frozen;
    expect(validateTaxDataFile(m)).toEqual([]);
  });

  // Review of TAB-VAL: a table that really repeats for several years
  // (IRMAA 2011-2017) carries the same exception each year, and that must
  // pass; an exception copied along with a whole file from a year whose
  // tables moved must not excuse the copy.
  it("tax/TAB-VAL:freeze [TAX-06] an exception carried through a repeat lasting years", () => {
    const f = clone();
    const prev = latest(f);
    const y1 = String(Math.max(...Object.keys(f.years).map(Number)) + 1);
    const y2 = String(Number(y1) + 1);
    const exception = { reason: "Statutory freeze", source: prev.ltcg!.source };
    const repeatLtcg = (base: typeof prev) => {
      const y = JSON.parse(JSON.stringify(base)) as typeof prev;
      const up = (r: Record<string, number | null>) => {
        for (const k of [
          "threshold",
          "magiThreshold",
          "baseWithholding",
          "annualSurcharge",
        ])
          if (typeof r[k] === "number") r[k] = r[k] * 1.02;
      };
      for (const t of Object.values(y.withholding.tables))
        [...t.standard, ...t.checkbox].forEach((r) => up(r as never));
      for (const b of Object.values(y.irmaa!.brackets))
        b.forEach((r) => up(r as never));
      y.fpl = moveFpl(y.fpl!);
      y.ltcg = { ...base.ltcg!, exception };
      return y;
    };
    f.years[y1] = repeatLtcg(prev);
    f.years[y2] = repeatLtcg(f.years[y1]!);
    expect(validateTaxDataFile(f)).toEqual([]);

    // The latest shipped year's own exception (withholding, 2026) copied
    // with the whole file excuses nothing: that year's tables moved.
    const g = clone();
    const copy = JSON.parse(JSON.stringify(prev)) as typeof prev;
    g.years[y1] = copy;
    const flagged = validateTaxDataFile(g).map((p) => p.split(":")[0]);
    expect(flagged).toContain(`${y1} withholding Single standard`);
  });

  /** The latest year carried to the next with every indexed table moved
   *  2% (and the guidelines 3%): a clean next year to break one thing in. */
  const nextYear = (base: Year): Year => {
    const y = JSON.parse(JSON.stringify(base)) as Year;
    const up = (r: Record<string, number | null>) => {
      for (const k of [
        "threshold",
        "magiThreshold",
        "baseWithholding",
        "annualSurcharge",
      ])
        if (typeof r[k] === "number") r[k] = r[k] * 1.02;
    };
    for (const t of Object.values(y.withholding.tables))
      [...t.standard, ...t.checkbox].forEach((r) => up(r as never));
    for (const s of ["ltcg", "irmaa"] as const)
      for (const b of Object.values(y[s]!.brackets))
        b.forEach((r) => up(r as never));
    y.fpl = moveFpl(y.fpl!);
    delete y.withholding.exception;
    return y;
  };
  const years = (f: typeof file) => {
    const y1 = String(Math.max(...Object.keys(f.years).map(Number)) + 1);
    return { y1, y2: String(Number(y1) + 1) };
  };

  // The poverty guidelines move every year (HHS), so a next year whose
  // amounts equal the prior year's, size for size, was copied.
  it("poverty guidelines copied from the prior year, unless the year's own exception says why", () => {
    const f = clone();
    const prev = latest(f);
    const { y1, y2 } = years(f);
    const copied = nextYear(prev);
    copied.fpl = JSON.parse(JSON.stringify(prev.fpl)) as Year["fpl"];
    f.years[y1] = copied;
    const problems = validateTaxDataFile(f);
    expect(problems.map((p) => p.split(":")[0])).toEqual([`${y1} fpl amounts`]);
    expect(problems[0]).toMatch(
      new RegExp(`the same amounts as .*give ${y1} fpl an exception`),
    );

    // The year's own exception ships it, and the same exception carried
    // into a second year that repeats again still counts.
    const exception = {
      reason: "Published unchanged",
      source: prev.fpl!.source,
    };
    copied.fpl!.exception = exception;
    expect(validateTaxDataFile(f)).toEqual([]);
    const again = nextYear(copied);
    again.fpl = JSON.parse(JSON.stringify(copied.fpl)) as Year["fpl"];
    f.years[y2] = again;
    expect(validateTaxDataFile(f)).toEqual([]);

    // Carried from a year whose amounts moved, it excuses nothing.
    const g = clone();
    latest(g).fpl!.exception = exception;
    g.years[y1] = { ...nextYear(latest(g)), fpl: latest(g).fpl };
    expect(validateTaxDataFile(g).map((p) => p.split(":")[0])).toEqual([
      `${y1} fpl amounts`,
    ]);
  });

  // The bounds check counts an exception the way the copy check does:
  // the year's own, or carried from a prior year that broke the bounds
  // too. A limit's exception is per limit.
  it("an out-of-bounds jump excused only by an exception copied from a year in bounds", () => {
    const f = clone();
    const prev = latest(f);
    const { y1 } = years(f);
    const wageBase = prev.limits.ss_wage_base!;
    const exception = { reason: "Law change", source: wageBase.source };
    wageBase.exception = exception;
    // The prior year's own exception, with the figure in bounds: harmless.
    expect(validateTaxDataFile(f)).toEqual([]);
    const jumped = nextYear(prev);
    jumped.limits.ss_wage_base!.value *= 2;
    f.years[y1] = jumped;
    expect(validateTaxDataFile(f).map((p) => p.split(":")[0])).toEqual([
      `${y1} ss_wage_base`,
    ]);
    // The year's own exception (a different reason) excuses the jump.
    jumped.limits.ss_wage_base!.exception = { ...exception, reason: "New law" };
    expect(validateTaxDataFile(f)).toEqual([]);

    // A section's exception the same way: LTCG given one in a year whose
    // thresholds stayed in bounds, then carried into a 20% jump.
    const g = clone();
    latest(g).ltcg!.exception = {
      ...exception,
      source: latest(g).ltcg!.source,
    };
    const ltcg = nextYear(latest(g));
    for (const b of Object.values(ltcg.ltcg!.brackets))
      for (const r of b as { threshold: number | null }[])
        if (r.threshold) r.threshold *= 1.2;
    g.years[y1] = ltcg;
    const flagged = validateTaxDataFile(g).map((p) => p.split(":")[0]!);
    expect(flagged.length).toBeGreaterThan(0);
    expect(flagged.every((p) => p.startsWith(`${y1} ltcg `))).toBe(true);
  });

  it("an excused jump lasting several years, one exception carried through", () => {
    const f = clone();
    const prev = latest(f);
    const { y1, y2 } = years(f);
    const exception = {
      reason: "Phased in over two years",
      source: prev.limits.ss_wage_base!.source,
    };
    const step = (base: Year) => {
      const y = nextYear(base);
      y.limits.ss_wage_base = {
        ...y.limits.ss_wage_base!,
        value: base.limits.ss_wage_base!.value * 1.5,
        exception,
      };
      return y;
    };
    f.years[y1] = step(prev);
    f.years[y2] = step(f.years[y1]!);
    expect(validateTaxDataFile(f)).toEqual([]);

    // The shipped 2026 withholding exception (the OBBBA jump from 2025)
    // carried into a next year that jumps again: excused the same way.
    const g = clone();
    const withholding = nextYear(latest(g));
    withholding.withholding = JSON.parse(
      JSON.stringify(latest(g).withholding),
    ) as Year["withholding"];
    for (const t of Object.values(withholding.withholding.tables))
      for (const r of [...t.standard, ...t.checkbox] as {
        threshold: number;
        baseWithholding: number;
      }[]) {
        r.threshold *= 1.2;
        r.baseWithholding *= 1.2;
      }
    g.years[y1] = withholding;
    expect(latest(clone()).withholding.exception).toBeDefined();
    expect(validateTaxDataFile(g)).toEqual([]);
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
