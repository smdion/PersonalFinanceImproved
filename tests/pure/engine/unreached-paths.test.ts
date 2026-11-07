/**
 * Engine paths no baseline household reaches (v0.10.4 plan commit 27b,
 * from v0.10.3's advisor batches A2 L3 and B L3; owner Q2: added as
 * pins). Each case is an invented household built to take one path; it
 * first proves it got there (a figure or field only that path sets), then
 * pins the year's figures and every account's draw, `draw.reason`
 * included, to `__pins__/unreached-paths.json`. These pin today's
 * behavior as it is; a figure that looks wrong is pinned and listed for
 * v0.11, not fixed here. `LEDGR_BASELINE_WRITE=1` writes the file.
 */
import { assert, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { calculateProjection } from "@/lib/pure/engine";
import type {
  EngineAccumulationYear,
  EngineDecumulationYear,
  EngineYearProjection,
  ProjectionInput,
} from "@/lib/pure/engine/types";
import type { IndividualAccountInput } from "@/lib/pure/accounts/account-balances.types";
import { roundToCents } from "@/lib/utils/math";
import { acct, household } from "../fixtures/two-person-household";

const FILE = path.join(__dirname, "__pins__", "unreached-paths.json");
const WRITE = process.env.LEDGR_BASELINE_WRITE === "1";
const pins: Record<string, unknown> = fs.existsSync(FILE)
  ? (JSON.parse(fs.readFileSync(FILE, "utf8")) as Record<string, unknown>)
  : {};
const written: Record<string, unknown> = {};

/** The year's figures this file pins, in a fixed order. */
const DECUM_FIELDS = [
  "year",
  "age",
  "projectedExpenses",
  "spending",
  "afterTaxNeed",
  "targetWithdrawal",
  "totalWithdrawal",
  "totalTraditionalWithdrawal",
  "totalRothWithdrawal",
  "taxCost",
  "ssTaxCost",
  "ssIncome",
  "taxableSS",
  "penaltyCost",
  "unmetNeed",
  "rmdAmount",
  "rmdByPerson",
  "rmdOverrodeRouting",
  "rmdShortfallAmount",
  "rmdExcessAmount",
  "rmdReassignedAmount",
  "qcdAmount",
  "qcdByPerson",
  "rothConversionAmount",
  "rothConversionTaxCost",
  "niitAmount",
  "irmaaCost",
  "irmaaPaid",
] as const;
const ACCUM_FIELDS = [
  "year",
  "age",
  "proRateFraction",
  "totalEmployee",
  "totalEmployer",
  "rateCeilingScale",
  "savingStopped",
  "gapDraw",
] as const;

function view(y: EngineYearProjection) {
  const fields: readonly string[] =
    y.phase === "decumulation" ? DECUM_FIELDS : ACCUM_FIELDS;
  const row = new Map<string, unknown>(Object.entries(y));
  const out: Record<string, unknown> = {};
  for (const f of fields) if (row.get(f) !== undefined) out[f] = row.get(f);
  out.accounts = y.individualAccountBalances.map((a) => ({
    name: a.name,
    balance: a.balance,
    contribution: a.contribution,
    ...(a.draw ? { draw: a.draw } : {}),
    ...(a.roth ? { roth: a.roth } : {}),
  }));
  return out;
}

/** The case's years, through JSON (the pinned form). */
function pin(name: string, years: EngineYearProjection[]) {
  const value: unknown = JSON.parse(JSON.stringify(years.map(view)));
  written[name] = value;
  if (WRITE) {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(
      FILE,
      `${JSON.stringify({ ...pins, ...written }, null, 1)}\n`,
    );
    return;
  }
  expect(pins[name], `no pin for ${name}`).toBeDefined();
  expect(value).toEqual(pins[name]);
}

const run = (input: ProjectionInput) =>
  calculateProjection(input).projectionByYear;
const decum = (input: ProjectionInput) =>
  run(input).filter(
    (y): y is EngineDecumulationYear => y.phase === "decumulation",
  );
const accum = (input: ProjectionInput, year: number) => {
  const row = run(input).find((y) => y.year === year);
  assert(row?.phase === "accumulation");
  return row as EngineAccumulationYear;
};
const account = (y: EngineYearProjection, name: string) =>
  y.individualAccountBalances.find((a) => a.name === name)!;
const ss = (personId: 1 | 2, birthYear: number, annualAmount = 0) => ({
  personId,
  personName: personId === 1 ? "Ann" : "Bo",
  birthYear,
  startAge: 70,
  annualAmount,
});
const retirementBrokerage = (
  name: string,
  balance: number,
  owner: 1 | 2,
): IndividualAccountInput => ({
  ...acct(name, "brokerage", balance, owner, "afterTax"),
  parentCategory: "Retirement",
});

describe("RMD money past the need, Social Security covering part of the tax (A2 L3.1)", () => {
  // Ann 78: Social Security is $1,000 over the budget, so the RMD's
  // excess is reinvested net of the tax that $1,000 doesn't cover.
  const years = decum(
    household(
      [
        acct("Ann IRA", "ira", 600000, 1),
        retirementBrokerage("Ann brokerage", 50000, 1),
      ],
      {
        annualExpenses: 29000,
        socialSecurityEntries: [ss(1, 1948, 30000), ss(2, 1961)],
      },
      { rmdExcessHandling: "reinvest" },
    ),
  );
  const y = years[0]!;

  it("takes the path: a surplus smaller than the tax, credited against it", () => {
    const surplus = y.ssIncome - y.projectedExpenses;
    expect(surplus).toBeGreaterThan(0);
    expect(surplus).toBeLessThan(y.taxCost);
    expect(y.afterTaxNeed).toBe(0);
    expect(y.rmdOverrodeRouting).toBe(true);
    expect(y.rmdExcessAmount).toBe(
      roundToCents(y.totalWithdrawal - (y.taxCost - surplus)),
    );
  });

  it("pins the year", () => pin("rmd-excess-ss-surplus", [y]));
});

describe("two owners' RMDs, one short and one met (A2 L3.2)", () => {
  // Ann's IRA is Portfolio money, so her RMD can't be drawn from the plan;
  // Bo (76) meets his from his 401k.
  const years = decum(
    household(
      [
        { ...acct("Ann IRA", "ira", 500000, 1), parentCategory: "Portfolio" },
        acct("Bo 401k", "401k", 500000, 2),
      ],
      {
        socialSecurityEntries: [ss(1, 1948), ss(2, 1950)],
        perPersonBirthYears: [1948, 1950],
      },
    ),
  );
  const y = years[0]!;

  it("takes the path: the short row ends with its shortfall, the met row has none", () => {
    const [ann, bo] = [1, 2].map((id) =>
      y.rmdByPerson!.find((p) => p.personId === id)!,
    );
    expect(Object.keys(ann!).at(-1)).toBe("shortfall");
    expect(ann!.shortfall).toBe(ann!.amount);
    expect("shortfall" in bo!).toBe(false);
    expect(y.rmdShortfallAmount).toBe(ann!.shortfall);
  });

  it("pins the year", () => pin("rmd-two-owners-short-and-met", [y]));
});

describe("routing drew the wrong owner: the RMD is reassigned (A2 L3, rmdReassignedAmount)", () => {
  const y = decum(
    household([
      acct("Ann IRA", "ira", 500000, 1),
      acct("Bo 401k", "401k", 500000, 2),
    ]),
  )[0]!;

  it("takes the path: money moved between owners, none added", () => {
    expect(y.rmdReassignedAmount).toBeGreaterThan(0);
    expect(y.rmdOverrodeRouting).toBe(false);
  });

  it("pins the year", () => pin("rmd-reassigned", [y]));
});

describe("a QCD (A2 L3)", () => {
  const y = decum(
    household(
      [acct("Ann IRA", "ira", 500000, 1), acct("Bo 401k", "401k", 500000, 2)],
      {
        annualExpenses: 1000,
        socialSecurityEntries: [ss(1, 1948), ss(2, 1950)],
        perPersonBirthYears: [1948, 1950],
      },
      { qcdMaximize: true },
    ),
  )[0]!;

  it("takes the path", () => {
    expect(y.qcdAmount).toBeGreaterThan(0);
    expect(y.qcdByPerson).toEqual([{ personId: 1, qcdAmount: y.qcdAmount }]);
  });

  it("pins the year", () => pin("qcd", [y]));
});

describe("IRMAA paid on top of the budget (A2 L3)", () => {
  const years = decum(
    household(
      [
        acct("Ann 401k", "401k", 3000000, 1),
        acct("Bo 401k", "401k", 3000000, 2),
        acct("Cash", "brokerage", 500000, 1, "afterTax"),
      ],
      {
        annualExpenses: 400000,
        enableIrmaaAwareness: true,
        irmaaOnTopOfBudget: true,
        socialSecurityEntries: [ss(1, 1948), ss(2, 1951)],
        perPersonBirthYears: [1948, 1951],
      },
    ),
  );

  it("takes the path: before the lookback it lowers spending, after it joins the need", () => {
    const [first, , , fourth] = years;
    expect(first!.irmaaPaid).toBeGreaterThan(0);
    expect(first!.afterTaxNeed).toBe(first!.projectedExpenses);
    expect(fourth!.irmaaPaid).toBeGreaterThan(0);
    expect(fourth!.afterTaxNeed).toBe(
      roundToCents(fourth!.projectedExpenses + fourth!.irmaaPaid!),
    );
  });

  it("pins the years", () => pin("irmaa-on-top", [years[0]!, years[3]!]));
});

describe("a Roth conversion year with brokerage gains and NIIT (A2 L3.4)", () => {
  // Ann (66) and Bo (65), before their RMDs, live on a low-basis
  // brokerage and convert to the top of the 32% bracket, which puts the
  // gains over the NIIT threshold.
  const base = household(
    [
      acct("Ann 401k", "401k", 2000000, 1),
      {
        ...acct("Joint brokerage", "brokerage", 1500000, 1, "afterTax"),
        startingBasis: 150000,
      },
    ],
    {
      annualExpenses: 120000,
      currentAge: 66,
      birthYear: 1960,
      perPersonBirthYears: [1960, 1961],
      socialSecurityEntries: [ss(1, 1960), ss(2, 1961)],
    },
    {
      withdrawalOrder: ["brokerage", "401k", "403b", "ira", "hsa"],
      withdrawalSplits: { "401k": 0, "403b": 0, ira: 0, brokerage: 1, hsa: 0 },
    },
  );
  const d = base.decumulationDefaults;
  const input: ProjectionInput = {
    ...base,
    startingAccountBalances: {
      ...base.startingAccountBalances!,
      brokerage: {
        structure: "basis_tracking",
        balance: 1500000,
        basis: 150000,
      },
    },
    startingBalances: { ...base.startingBalances, afterTaxBasis: 150000 },
    decumulationDefaults: {
      ...d,
      distributionTaxRates: {
        ...d.distributionTaxRates,
        enableRothConversions: true,
        rothConversionTarget: 0.32,
        // Invented brackets: a conversion fills to a rate in these.
        taxBrackets: [
          { threshold: 0, baseWithholding: 0, rate: 0.1 },
          { threshold: 24000, baseWithholding: 2400, rate: 0.12 },
          { threshold: 96000, baseWithholding: 11040, rate: 0.22 },
          { threshold: 205000, baseWithholding: 35020, rate: 0.24 },
          { threshold: 390000, baseWithholding: 79420, rate: 0.32 },
          { threshold: 495000, baseWithholding: 113020, rate: 0.35 },
        ],
      },
    },
  };
  const y = decum(input)[0]!;

  it("takes the path: a conversion, gains drawn and NIIT owed", () => {
    expect(y.rothConversionAmount).toBeGreaterThan(0);
    expect(y.niitAmount).toBeGreaterThan(0);
    const brokerage = y.slots.find((s) => s.category === "brokerage")!;
    expect(brokerage.gainsPortion).toBeGreaterThan(0);
  });

  it("pins the year", () => pin("conversion-gains-niit", [y]));
});

describe("the five eligibility reasons no household shows (B L3)", () => {
  // Ann (52) and Bo (54) retired early. Ann's two Roth IRAs: one all
  // basis, one partly; her 401k met the Rule of 55 with no year on record,
  // and her other 401k didn't. Bo's 401k has the Rule of 55 turned off.
  const roth = (name: string, balance: number, basis: number) => ({
    ...acct(name, "ira", balance, 1, "taxFree"),
    ownerBirthYear: 1974,
    rothBasisMeta: {
      year: 2026,
      contributionBasis: basis,
      conversionBasis: 0,
      latestConversionYear: null,
      isSeeded: false,
      updatedAt: new Date("2026-01-01"),
    },
  });
  const accounts: IndividualAccountInput[] = [
    roth("Ann Roth all basis", 40000, 60000),
    roth("Ann Roth part basis", 200000, 50000),
    {
      ...acct("Ann 401k R55", "401k", 300000, 1),
      ownerBirthYear: 1974,
      ruleOf55: {
        eligible: true,
        separationYear: null,
        source: "explicit",
        knownFutureSeparationYear: null,
      },
    },
    {
      ...acct("Ann 401k", "401k", 300000, 1),
      ownerBirthYear: 1974,
      ruleOf55: null,
    },
    {
      ...acct("Bo 401k", "401k", 300000, 2),
      ownerBirthYear: 1972,
      ruleOf55ForceIneligible: true,
    },
    acct("Joint brokerage", "brokerage", 400000, undefined, "afterTax"),
  ];
  const y = decum(
    household(accounts, {
      currentAge: 52,
      birthYear: 1974,
      perPersonBirthYears: [1974, 1972],
      socialSecurityEntries: [ss(1, 1974), ss(2, 1972)],
      annualExpenses: 60000,
    }),
  )[0]!;

  it("takes the path: each account shows its reason", () => {
    const reason = (name: string) => account(y, name).draw?.reason;
    expect(reason("Ann Roth all basis")).toMatchObject({
      kind: "basis_remaining",
    });
    expect(reason("Ann Roth part basis")).toMatchObject({
      kind: "basis_partial",
    });
    expect(reason("Ann 401k R55")).toEqual({ kind: "rule_of_55" });
    expect(reason("Ann 401k")).toMatchObject({
      kind: "locked",
      gate: "rule_of_55_or_age",
    });
    expect(reason("Bo 401k")).toMatchObject({
      kind: "locked",
      gate: "rule_of_55_unavailable",
    });
  });

  it("pins the year", () => pin("eligibility-reasons", [y]));
});

/** Working-years cases: Ann (50) earns $100,000 into a 401k and a
 *  Portfolio brokerage; the clock is the fixture's (March 2026), so
 *  year 0 is part of a year. */
function worker(
  overrides: Partial<ProjectionInput>,
  accounts: IndividualAccountInput[] = [
    acct("Ann 401k", "401k", 200000, 1),
    {
      ...acct("Ann brokerage", "brokerage", 50000, 1, "afterTax"),
      parentCategory: "Portfolio",
    },
  ],
): ProjectionInput {
  return household(accounts, {
    currentAge: 50,
    birthYear: 1976,
    perPersonBirthYears: [1976],
    socialSecurityEntries: [ss(1, 1976)],
    retirementYear: 2036,
    projectionEndYear: 2038,
    currentSalary: 100000,
    salaryGrowthRate: 0,
    annualExpenses: 50000,
    ...overrides,
  });
}
const specs = [
  {
    category: "401k",
    name: "Ann 401k",
    accountName: "Ann 401k",
    method: "percent_of_salary",
    value: 0.1,
    salaryFraction: 1,
    baseAnnual: 10000,
    taxTreatment: "pre_tax",
    personId: 1,
    ownerName: "Ann",
    parentCategory: "Retirement",
  },
  {
    category: "brokerage",
    name: "Ann brokerage",
    accountName: "Ann brokerage",
    method: "fixed_monthly",
    value: 500,
    salaryFraction: 1,
    baseAnnual: 6000,
    taxTreatment: "after_tax",
    personId: 1,
    ownerName: "Ann",
    parentCategory: "Portfolio",
  },
] as ProjectionInput["contributionSpecs"];
const atRate = (contributionRate: number) => {
  const base = worker({ contributionSpecs: specs });
  return {
    ...base,
    accumulationDefaults: { ...base.accumulationDefaults, contributionRate },
  };
};

describe("the retirement-rate ceiling (A2 L3.3)", () => {
  it("doesn't bite at 25%: no scale", () => {
    const y = accum(atRate(0.25), 2026);
    expect(y.rateCeilingScale).toBeNull();
    pin("rate-ceiling-not-biting", [y]);
  });

  it("bites at 5% in year 0, the Portfolio slot kept whole", () => {
    const y = accum(atRate(0.05), 2026);
    const fraction = y.proRateFraction!;
    expect(fraction).toBeGreaterThan(0);
    expect(fraction).toBeLessThan(1);
    expect(y.rateCeilingScale).not.toBeNull();
    expect(y.rateCeilingScale!).toBeLessThan(1);
    // The 401k is cut to 5% of the year's pay; the brokerage isn't.
    expect(account(y, "Ann 401k").contribution).toBeCloseTo(
      100000 * 0.05 * fraction,
      1,
    );
    expect(account(y, "Ann brokerage").contribution).toBeCloseTo(
      6000 * fraction,
      1,
    );
    pin("rate-ceiling-biting-year-0", [y]);
  });
});

describe("a gap year in year 0 (A2 L3.5)", () => {
  // Ann's job ended in 2025; she retires in 2036. Year 0 is March to
  // December, so the budget is drawn for that part of the year, from the
  // brokerage (her 401k is locked at 50).
  const y = accum(
    worker({ workingYearsByPerson: { 1: { start: null, end: 2025 } } }, [
      { ...acct("Ann 401k", "401k", 200000, 1), ownerBirthYear: 1976 },
      {
        ...retirementBrokerage("Ann brokerage", 300000, 1),
        ownerBirthYear: 1976,
      },
    ]),
    2026,
  );

  it("takes the path: the year-0 budget is the year's share", () => {
    const fraction = y.proRateFraction!;
    expect(fraction).toBeLessThan(1);
    assert(y.gapDraw);
    expect(y.gapDraw.spending).toBeCloseTo(50000 * fraction, 1);
    expect(y.gapDraw.withdrawal).toBeGreaterThan(0);
    expect(account(y, "Ann 401k").draw?.reason).toMatchObject({
      kind: "locked",
    });
  });

  it("pins the year", () => pin("gap-year-0", [y]));
});

describe("a gap year in year 0, drawn from a 401k with no owner's age", () => {
  // The same year from a 401k whose owner has no birth year on record
  // (nothing gates it): taxed at the fallback rate.
  const y = accum(
    worker({ workingYearsByPerson: { 1: { start: null, end: 2025 } } }, [
      acct("Ann 401k", "401k", 200000, 1),
      retirementBrokerage("Ann brokerage", 300000, 1),
    ]),
    2026,
  );

  it("takes the path: the year's share, drawn pre-tax", () => {
    assert(y.gapDraw);
    expect(y.gapDraw.spending).toBeCloseTo(50000 * y.proRateFraction!, 1);
    expect(y.gapDraw.taxCost).toBeGreaterThan(0);
  });

  it("pins the year", () => pin("gap-year-0-unowned", [y]));
});
