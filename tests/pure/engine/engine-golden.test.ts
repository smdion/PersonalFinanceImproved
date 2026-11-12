/**
 * Engine golden fixtures (ENG-01): whole projections whose every year is
 * worked by hand, never read from `src/`. They are the reviewed half of the
 * engine's fixtures; `engine-snapshot.test.ts` holds the other half, the
 * regression pins, which record what the code produced when they were
 * written and say nothing about whether it was right.
 *
 * A golden fixture's review is tied to its input, not to a date:
 * `reviewed.json` (beside this file) is keyed by the sha256 of the engine
 * input each fixture runs. Change a fixture's input and its hash leaves
 * the file, so the test fails until someone re-derives the figures by hand
 * and records the new hash with what they checked. No clock is read.
 *
 * The arithmetic, from ARCHITECTURE.md § One year: a working year credits
 * the year's contributions, then grows; a retirement year takes the draw,
 * then grows. So each account ends a year at
 *
 *   (start + contributions − draws) × (1 + return).
 *
 * Invented households only (`answer-key-household.ts`: the shipped 2026
 * tax tables, waterfall routing, no conversions, IRMAA and ACA off), the
 * plan starting 2026-01-01 (a whole year 0). Every draw below is tax-free
 * by construction (a brokerage sold under the 0% capital-gains band and
 * the standard deduction, or Social Security under the $25,000 provisional
 * income line), except GOLD-5, whose gross-up is worked in its comment.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { cents } from "../../fixtures/answer-key";
import {
  engineHousehold,
  type KeyHousehold,
} from "../../fixtures/answer-key-household";
import { calculateProjection } from "@/lib/pure/engine";
import type { ProjectionInput } from "@/lib/pure/engine/types";

interface GoldenYear {
  year: number;
  /** Every account's balance at the year's end. */
  balance: number;
  /** A retirement year's spending and gross draw. */
  spending?: number;
  draw?: number;
}

interface Golden {
  /** `engine/GOLD-<n>`, the key `reviewed.json` names. */
  id: string;
  input: ProjectionInput;
  years: GoldenYear[];
  depletionYear: number | null;
}

/** The household at `rate` return and `inflation`. */
function at(h: KeyHousehold, rate: number, inflation = 0): ProjectionInput {
  return {
    ...engineHousehold(h),
    returnRates: [{ label: "Age 0", rate }],
    inflationRate: inflation,
  };
}

/** The household saving `rate` of pay, all of it to the brokerage. */
function saving(input: ProjectionInput, rate: number): ProjectionInput {
  const splits = Object.fromEntries(
    Object.keys(input.accumulationDefaults.accountSplits).map((c) => [
      c,
      c === "brokerage" ? 1 : 0,
    ]),
  ) as ProjectionInput["accumulationDefaults"]["accountSplits"];
  return {
    ...input,
    accumulationDefaults: {
      ...input.accumulationDefaults,
      contributionRate: rate,
      accountOrder: ["brokerage"],
      accountSplits: splits,
    },
  };
}

const GOLDEN: Golden[] = [
  {
    // Single, born 1960, a $200,000 brokerage at full basis, spending
    // $40,000, 5% return, 0% inflation, to 2033.
    //   2026: (200,000.00 − 40,000) × 1.05 = 168,000.00
    //   2027: (168,000.00 − 40,000) × 1.05 = 134,400.00
    //   2028: (134,400.00 − 40,000) × 1.05 =  99,120.00
    //   2029: ( 99,120.00 − 40,000) × 1.05 =  62,076.00
    //   2030: ( 62,076.00 − 40,000) × 1.05 =  23,179.80
    //   2031: the last 23,179.80 is drawn; 16,820.20 short; nothing left.
    // The gain sold is at most the whole growth (about 47,000 over six
    // years), far under the 0% band, so no draw is grossed up for tax.
    id: "engine/GOLD-1",
    input: at(
      {
        status: "Single",
        people: [{ birthYear: 1960 }],
        brokerage: { balance: 200_000, basis: 200_000 },
        spending: 40_000,
        endYear: 2034,
      },
      0.05,
    ),
    years: [
      { year: 2026, balance: 168_000, spending: 40_000, draw: 40_000 },
      { year: 2027, balance: 134_400, spending: 40_000, draw: 40_000 },
      { year: 2028, balance: 99_120, spending: 40_000, draw: 40_000 },
      { year: 2029, balance: 62_076, spending: 40_000, draw: 40_000 },
      { year: 2030, balance: 23_179.8, spending: 40_000, draw: 40_000 },
      { year: 2031, balance: 0, spending: 40_000, draw: 23_179.8 },
      { year: 2032, balance: 0, spending: 40_000, draw: 0 },
      { year: 2033, balance: 0, spending: 40_000, draw: 0 },
    ],
    depletionYear: 2031,
  },
  {
    // Single, born 1960, a $500,000 brokerage at full basis, spending
    // $20,000 in 2026 dollars, 4% return, 3% inflation, to 2028. Spending
    // grows by inflation from the plan's first year:
    //   2026: 20,000.00;  2027: 20,000 × 1.03 = 20,600.00;
    //   2028: 20,000 × 1.03² = 21,218.00.
    //   2026: (500,000.00 − 20,000.00) × 1.04 = 499,200.00
    //   2027: (499,200.00 − 20,600.00) × 1.04 = 497,744.00
    //   2028: (497,744.00 − 21,218.00) × 1.04 = 495,587.04
    id: "engine/GOLD-2",
    input: at(
      {
        status: "Single",
        people: [{ birthYear: 1960 }],
        brokerage: { balance: 500_000, basis: 500_000 },
        spending: 20_000,
        endYear: 2029,
      },
      0.04,
      0.03,
    ),
    years: [
      { year: 2026, balance: 499_200, spending: 20_000, draw: 20_000 },
      { year: 2027, balance: 497_744, spending: 20_600, draw: 20_600 },
      { year: 2028, balance: 495_587.04, spending: 21_218, draw: 21_218 },
    ],
    depletionYear: null,
  },
  {
    // Single, born 1966, $100,000 a year to 2027, saving 10% (10,000) to a
    // $50,000 brokerage at full basis; spending $60,000; 5%, 0% inflation.
    // Working years (pay covers spending, nothing drawn):
    //   2026: (50,000.00 + 10,000) × 1.05 = 63,000.00
    //   2027: (63,000.00 + 10,000) × 1.05 = 76,650.00
    // Retired from 2028 (62: no Social Security, no penalty on a brokerage):
    //   2028: (76,650.00 − 60,000) × 1.05 = 17,482.50
    //   2029: the last 17,482.50 is drawn; nothing left.
    // The gain sold in 2028 is 60,000 × 6,650 / 76,650 = 5,205.48, under
    // the standard deduction alone: no tax.
    id: "engine/GOLD-3",
    input: saving(
      at(
        {
          status: "Single",
          people: [
            { birthYear: 1966, job: { salary: 100_000, lastYear: 2027 } },
          ],
          brokerage: { balance: 50_000, basis: 50_000 },
          spending: 60_000,
          endYear: 2031,
        },
        0.05,
      ),
      0.1,
    ),
    years: [
      { year: 2026, balance: 63_000 },
      { year: 2027, balance: 76_650 },
      { year: 2028, balance: 17_482.5, spending: 60_000, draw: 60_000 },
      { year: 2029, balance: 0, spending: 60_000, draw: 17_482.5 },
      { year: 2030, balance: 0, spending: 60_000, draw: 0 },
    ],
    depletionYear: 2029,
  },
  {
    // Single, born 1955 (71), Social Security $24,000 a year (claimed, 0%
    // COLA), a $300,000 brokerage at full basis, spending $40,000; 0%
    // return and inflation, to 2028. Provisional income is half the
    // benefit, 12,000, under the $25,000 line: none of it is taxed, and a
    // brokerage at 0% return holds no gain. Each year draws
    // 40,000 − 24,000 = 16,000:
    //   2026: 284,000.00;  2027: 268,000.00;  2028: 252,000.00.
    id: "engine/GOLD-4",
    input: at(
      {
        status: "Single",
        people: [{ birthYear: 1955, socialSecurity: 24_000 }],
        brokerage: { balance: 300_000, basis: 300_000 },
        spending: 40_000,
        endYear: 2029,
      },
      0,
    ),
    years: [
      { year: 2026, balance: 284_000, spending: 40_000, draw: 16_000 },
      { year: 2027, balance: 268_000, spending: 40_000, draw: 16_000 },
      { year: 2028, balance: 252_000, spending: 40_000, draw: 16_000 },
    ],
    depletionYear: null,
  },
  {
    // Single, born 1964 (62 and 63: no 65+ add-on, no RMD, past 59½ so no
    // penalty), a $300,000 Traditional IRA, spending $40,000; 5% return,
    // 0% inflation, so the 2026 tables hold both years. The draw grosses
    // up for its own tax. 2026 Single: standard deduction 16,100; 10% to
    // 12,400, 12% to 50,400. With W in the 12% band,
    //   tax(W) = 1,240 + 0.12 × (W − 16,100 − 12,400) = 0.12 W − 2,180,
    //   W − tax(W) = 40,000  →  0.88 W = 37,820  →  W = 42,977.27
    // (tax 2,977.27), the same draw both years:
    //   2026: (300,000.00 − 42,977.27) × 1.05 = 269,873.87
    //   2027: (269,873.87 − 42,977.27) × 1.05 = 238,241.43
    // (to the cent: 257,022.73 × 1.05 = 269,873.8665; then
    // 226,896.5965 × 1.05 = 238,241.4263).
    id: "engine/GOLD-5",
    input: at(
      {
        status: "Single",
        people: [{ birthYear: 1964 }],
        traditionalIra: 300_000,
        spending: 40_000,
        endYear: 2028,
      },
      0.05,
    ),
    years: [
      { year: 2026, balance: 269_873.87, spending: 40_000, draw: 42_977.27 },
      { year: 2027, balance: 238_241.43, spending: 40_000, draw: 42_977.27 },
    ],
    depletionYear: null,
  },
  {
    // Single, born 1960, a $400,000 brokerage at full basis, spending
    // $36,000 until a budget of $2,000 a month from 2028 on (sticky
    // forward); 0% return and inflation, to 2029:
    //   2026: 400,000 − 36,000 = 364,000.00
    //   2027: 364,000 − 36,000 = 328,000.00
    //   2028: 328,000 − 24,000 = 304,000.00
    //   2029: 304,000 − 24,000 = 280,000.00
    id: "engine/GOLD-6",
    input: at(
      {
        status: "Single",
        people: [{ birthYear: 1960 }],
        brokerage: { balance: 400_000, basis: 400_000 },
        spending: 36_000,
        budgetFrom: [{ year: 2028, monthly: 2_000 }],
        endYear: 2030,
      },
      0,
    ),
    years: [
      { year: 2026, balance: 364_000, spending: 36_000, draw: 36_000 },
      { year: 2027, balance: 328_000, spending: 36_000, draw: 36_000 },
      { year: 2028, balance: 304_000, spending: 24_000, draw: 24_000 },
      { year: 2029, balance: 280_000, spending: 24_000, draw: 24_000 },
    ],
    depletionYear: null,
  },
];

// ── Review records, keyed by input hash ─────────────────────────────────

/** JSON with sorted keys; Dates as ISO strings, Maps as sorted entries. */
function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Map)
    return [...value.entries()]
      .map(([k, v]) => [String(k), canonical(v)] as const)
      .sort(([a], [b]) => a.localeCompare(b));
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}

function inputHash(input: ProjectionInput): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(input)))
    .digest("hex");
}

interface ReviewRecord {
  fixture: string;
  reviewed: string;
  checked: string;
}

const REVIEWED_FILE = path.join(__dirname, "reviewed.json");
const reviewed = (
  JSON.parse(fs.readFileSync(REVIEWED_FILE, "utf8")) as {
    inputs: Record<string, ReviewRecord>;
  }
).inputs;

/** Every worked year of fixture `id`, to the cent, and its depletion year. */
function checkGolden(id: string): void {
  const g = GOLDEN.find((f) => f.id === id);
  if (!g) throw new Error(`no golden fixture ${id}`);
  const result = calculateProjection(g.input);
  const rows = result.projectionByYear;
  for (const want of g.years) {
    // Found by year: the end year isn't run yet (RULES § Known Gaps,
    // decision D10), so each fixture's end year is one past its last
    // worked year and holds either way.
    const row = rows.find((r) => r.year === want.year);
    if (!row) throw new Error(`no ${want.year} in the projection`);
    const got: Record<string, number> = {
      balance: row.allAccountsBalance,
    };
    const expected: Record<string, number> = { balance: want.balance };
    if (want.draw !== undefined) {
      expect(row.phase, `${want.year}`).toBe("decumulation");
      if (row.phase === "decumulation") {
        got.draw = row.totalWithdrawal;
        got.spending = row.projectedExpenses;
        expected.draw = want.draw;
        expected.spending = want.spending!;
      }
    } else expect(row.phase, `${want.year}`).toBe("accumulation");
    cents(got, expected);
  }
  expect(result.retirementDepletionYear).toBe(g.depletionYear);
}

describe("engine golden fixtures (worked by hand)", () => {
  it("engine/GOLD-1 [ENG-01] a retiree's brokerage at 5%, spent down to nothing in 2031", () =>
    checkGolden("engine/GOLD-1"));
  it("engine/GOLD-2 [ENG-01] spending grows by inflation from the plan's first year", () =>
    checkGolden("engine/GOLD-2"));
  it("engine/GOLD-3 [ENG-01] two working years saving 10%, then a retirement that runs out in 2029", () =>
    checkGolden("engine/GOLD-3"));
  it("engine/GOLD-4 [ENG-01] Social Security pays part of the spending; the brokerage the rest", () =>
    checkGolden("engine/GOLD-4"));
  it("engine/GOLD-5 [ENG-01] a Traditional IRA draw grossed up for its tax, two years", () =>
    checkGolden("engine/GOLD-5"));
  it("engine/GOLD-6 [ENG-01] a budget change from 2028 holds for every later year", () =>
    checkGolden("engine/GOLD-6"));

  it("every golden fixture's input is the one its review recorded", () => {
    const unreviewed = GOLDEN.filter(
      (g) => reviewed[inputHash(g.input)]?.fixture !== g.id,
    ).map((g) => `${g.id}: ${inputHash(g.input)}`);
    expect(
      unreviewed,
      "a golden fixture's input changed: re-derive its figures by hand, " +
        "then record the new hash in tests/pure/engine/reviewed.json with " +
        "what was checked",
    ).toEqual([]);
  });

  it("reviewed.json names no input that no fixture runs", () => {
    const hashes = new Set(GOLDEN.map((g) => inputHash(g.input)));
    expect(Object.keys(reviewed).filter((h) => !hashes.has(h))).toEqual([]);
  });
});
