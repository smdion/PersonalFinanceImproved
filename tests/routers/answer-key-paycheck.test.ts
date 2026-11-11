/**
 * Answer key, paycheck through the router (`paycheck.computeSummary` on
 * the seeded test database): the rows the paycheck verdicts ran on the
 * real path (`rebuild/paycheck-verdicts.md` K1, N1–N6, Y1, Y2; probe saved
 * as `.scratch/docs/drafts/answer-key-inputs/paycheck/skeptic-realpath.test.ts`)
 * and the CPA worksheet's H3v, as collected in the draft answer key
 * (`.scratch/docs/drafts/answer-key.md` § Paycheck, router level). The
 * bracketed part of each title is the docs/CALCULATIONS.md row.
 *
 * Every household is invented: one person born 1986-02-10, one job, W-4
 * Single unless stated, the clock at 2026-08-14 noon unless stated. Every
 * expected figure is worked by hand, never read from `src/`:
 *
 * - Withholding: Pub 15-T (2026) Worksheet 1A with the printed columns
 *   (1c = wages × P; 1g 8,600 Single, 12,900 MFJ; 2a = 1c − 1g; the row
 *   with A ≤ 2a < B; 2g = C + (2a − A) × D; 2h = 2g / P), rounded to the
 *   cent a check. Bonuses at the flat 22% (Pub 15 (2026) § 7, method 1a),
 *   37% on supplemental wages past $1,000,000 (§ 7; Reg.
 *   31.3402(g)-1(a)(2)).
 * - FICA: 6.2% to the 184,500 base (IRC 3101(a), 3121(a)(1)), 1.45%
 *   Medicare, 0.9% Additional Medicare withheld past this employer's
 *   200,000 (IRC 3102(f)), in pay-date order, the bonus with the check it
 *   is paid on (spec PW-6, PW-7, PW-8.1).
 * - A year's take-home is the sum of each check's net, bonus included
 *   (spec PW-8.2, PW-9.5). Sums of per-check lines may differ from a
 *   closed form by ±$0.01 a check (PW-3.15), so year take-home figures are
 *   held to ±$0.26 on 26 checks (the today pins too: each is hundreds of
 *   dollars from the worked figure).
 *
 * Not written: the probe's extra runs that aren't key rows (an HSA with
 * no coverage, N3 under the limit, a percent-of-pay N3, N2 biweekly at
 * $250,000, N5 weekly); the semimonthly June 15 bonus is case
 * paycheck/PAY19-1 in `tests/pure/paycheck/answer-key-paycheck.test.ts`.
 *
 * The year-to-date panels (Y1) sum the router's year schedule in the
 * component (`annual-summary.tsx`, `household-income-card.tsx`): the
 * case sums it the same way, through `yearTotals`.
 */
import "./setup-mocks";
import { afterAll, beforeAll, describe, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  createTestCaller,
  seedContributionAccount,
  seedContributionProfile,
  seedJob,
  seedPerson,
} from "./setup";
import * as schema from "@/lib/db/schema-sqlite";
import { withheldThroughPeriod } from "@/lib/pure/paycheck/year-schedule";
import { yearTotals } from "@/lib/pure/paycheck/year-totals";
import { cents, xfail } from "../fixtures/answer-key";

vi.mock("@/lib/budget-api", () => ({
  getActiveBudgetApi: vi.fn().mockResolvedValue("none"),
  cacheGet: vi.fn().mockResolvedValue(null),
}));

const NOON_AUG_14 = "2026-08-14T12:00:00Z";
/** PW-3.15: ±$0.01 a check on a year's sum of 26 checks. */
const YEAR_TOLERANCE = 0.26;

const N5 =
  'v0.11 Paycheck "27 or 53 payday year: real paydays" (decision "A 27 or 53 payday year uses real paydays")';

type SeedJob = Parameters<typeof seedJob>[2];

type AccountRow = typeof schema.contributionAccounts.$inferInsert;

interface Contribution {
  accountType: AccountRow["accountType"];
  taxTreatment: NonNullable<AccountRow["taxTreatment"]>;
  /** Per check (`fixed_per_period`). */
  perCheck: number;
  hsaCoverageType?: AccountRow["hsaCoverageType"];
}

const hsa = (perCheck: number): Contribution => ({
  accountType: "hsa",
  taxTreatment: "hsa",
  perCheck,
  hsaCoverageType: "self_only",
});

/** Biweekly from Friday January 2, 2026 (26 paydays, the last December 18). */
const BIWEEKLY: SeedJob = {
  payPeriod: "biweekly",
  payWeek: "even",
  anchorPayDate: "2026-01-02",
};
const MONTHLY: SeedJob = { payPeriod: "monthly", payWeek: "na" };

/**
 * One household's `computeSummary`, run once and shared by a case's tests
 * (an expected failure and its today pin read the same run).
 */
function household(c: {
  job: SeedJob;
  contributions?: Contribution[];
  now?: string;
}) {
  let summary: Awaited<ReturnType<typeof compute>> | undefined;
  async function compute() {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(c.now ?? NOON_AUG_14));
    const t = await createTestCaller();
    try {
      const personId = await seedPerson(t.db, "Example", "1986-02-10");
      t.db
        .update(schema.people)
        .set({ isPrimaryUser: true })
        .where(eq(schema.people.id, personId))
        .run();
      const jobId = seedJob(t.db, personId, {
        startDate: "2020-01-01",
        w4FilingStatus: "Single",
        ...c.job,
      });
      const fields: Record<
        string,
        { contributionValue: string; contributionMethod: string }
      > = {};
      for (const k of c.contributions ?? []) {
        const id = seedContributionAccount(t.db, {
          personId,
          jobId,
          accountType: k.accountType,
          taxTreatment: k.taxTreatment,
          hsaCoverageType: k.hsaCoverageType ?? null,
          priorYearContribAmount: "0",
        });
        fields[String(id)] = {
          contributionValue: String(k.perCheck),
          contributionMethod: "fixed_per_period",
        };
      }
      const contributionProfileId = seedContributionProfile(t.db, {
        name: "Answer key",
        contributionActiveFields: {
          contributionAccounts: fields,
          deductions: {},
        },
      });
      const result = await t.caller.paycheck.computeSummary({
        contributionProfileId,
      });
      const person = result.people[0]!;
      if (!person.paycheck || !person.earnings)
        throw new Error("the job has no paycheck");
      return {
        ...person,
        paycheck: person.paycheck,
        earnings: person.earnings,
      };
    } finally {
      t.cleanup();
      vi.useRealTimers();
    }
  }
  beforeAll(async () => {
    summary = await compute();
  });
  return () => {
    if (!summary) throw new Error("the household didn't run");
    return summary;
  };
}

type Summary = ReturnType<ReturnType<typeof household>>;

const round2 = (x: number) => Math.round(x * 100) / 100;

/** The year's take-home, as the Income card and the tax read it. */
const takeHome = (s: Summary) =>
  round2(s.earnings.netRegular + s.earnings.netBonus);

/** The schedule's rows this job pays (none before its start). */
const paidRows = (s: Summary) =>
  s.paycheck.yearSchedule.filter((r) => !r.beforeStart);

afterAll(() => vi.useRealTimers());

// ---------------------------------------------------------------------------
// K1: the year's take-home is the sum of the schedule, bonus included
// ---------------------------------------------------------------------------

/*
 * Single, $190,000 biweekly (26 checks of 7,307.69 = 189,999.94), a
 * $30,000 bonus. Per check, Worksheet 1A: 1c 189,999.94; 2a 181,399.94;
 * T26 Single row A 113,200, C 17,966, D 24%: 2g 17,966 + 24% × 68,199.94 =
 * 34,333.99; 2h / 26 = 1,320.54. Bonus federal 22% × 30,000 = 6,600.
 * Wages 219,999.94: SS 6.2% × 184,500 = 11,439.00; Medicare 1.45% =
 * 3,190.00; Additional Medicare 0.9% × 19,999.94 = 180.00. Take-home
 * 219,999.94 − 26 × 1,320.54 − 6,600 − 11,439 − 3,190 − 180 = 164,256.90;
 * by checks, rounding each line, 164,256.87 (March: the bonus on check 6,
 * March 13), 164,256.86 (December, check 25) and 164,256.86 (undated, on
 * the last check). The verdict's worked figures are kept, all inside
 * ±$0.26.
 */
describe("paycheck/K1: take-home equals the schedule's sum", () => {
  const march = household({
    job: {
      ...BIWEEKLY,
      annualSalary: "190000",
      bonusOverride: 30_000,
      bonusMonth: 3,
      bonusDayOfMonth: 15,
    },
  });
  it("paycheck/K1-190M [PAY-25] a March bonus: the year's take-home is the schedule's", () => {
    cents(takeHome(march()), 164_256.87, YEAR_TOLERANCE);
  });

  const december = household({
    job: {
      ...BIWEEKLY,
      annualSalary: "190000",
      bonusOverride: 30_000,
      bonusMonth: 12,
      bonusDayOfMonth: 15,
    },
  });
  it("paycheck/K1-190D [PAY-25] a December bonus: the year's take-home is the schedule's", () => {
    cents(takeHome(december()), 164_256.86, YEAR_TOLERANCE);
  });

  // No bonus date: the verdict's rule places it on the last check, which
  // gives the closed form, 164,256.90 (164,256.86 by rounded checks).
  const undated = household({
    job: { ...BIWEEKLY, annualSalary: "190000", bonusOverride: 30_000 },
  });
  it("paycheck/K1-190U [PAY-25] no date: the bonus is on the last check", () => {
    cents(takeHome(undated()), 164_256.9, YEAR_TOLERANCE);
  });

  // $170,000 (6,538.46 a check): 1c 169,999.96; 2a 161,399.96; row A
  // 113,200, C 17,966, D 24%: 2g 29,534.00; 2h 1,135.92. Wages 199,999.96:
  // SS 11,439.00; Medicare 2,900.00; no Additional Medicare. Take-home
  // 199,999.96 − 26 × 1,135.92 − 6,600 − 11,439 − 2,900 = 149,527.04
  // (149,527.08 by rounded checks). The verdict's 149,526.98 is kept,
  // inside ±$0.26.
  const k170 = household({
    job: {
      ...BIWEEKLY,
      annualSalary: "170000",
      bonusOverride: 30_000,
      bonusMonth: 3,
      bonusDayOfMonth: 15,
    },
  });
  it("paycheck/K1-170M [PAY-25] under $200,000 with the bonus: the year's take-home is the schedule's", () => {
    cents(takeHome(k170()), 149_526.98, YEAR_TOLERANCE);
  });

  // $150,000 (5,769.23 a check): 1c 149,999.98; 2a 141,399.98; row A
  // 113,200, C 17,966, D 24%: 2g 24,734.00; 2h 951.31. Wages 179,999.98,
  // under the base: SS 6.2% = 11,160.00, Medicare 2,610.00 (11,159.94 and
  // 2,609.90 by rounded checks). Take-home 179,999.98 − 26 × 951.31 −
  // 6,600 − 11,159.94 − 2,609.90 = 134,896.08. Under the base the estimate
  // and the schedule agree, so this holds today.
  const k150 = household({
    job: {
      ...BIWEEKLY,
      annualSalary: "150000",
      bonusOverride: 30_000,
      bonusMonth: 3,
      bonusDayOfMonth: 15,
    },
  });
  it("paycheck/K1-150M [PAY-25] under the base: the year's take-home is the schedule's", () => {
    cents(takeHome(k150()), 134_896.08);
  });

  // $240,000 monthly from July 1 (6 checks of 20,000), a $50,000 bonus
  // December 15. 1c 240,000; 2a 231,400; row A 209,275, C 41,024, D 32%:
  // 2g 48,104.00; 2h 4,008.67. Wages 170,000, under the base: SS
  // 10,540.00, Medicare 2,465.00. Take-home 170,000 − 6 × 4,008.67 −
  // 11,000 − 10,540 − 2,465 = 121,942.98.
  const partYear = household({
    job: {
      ...MONTHLY,
      annualSalary: "240000",
      startDate: "2026-07-01",
      bonusOverride: 50_000,
      bonusMonth: 12,
      bonusDayOfMonth: 15,
    },
  });
  it("paycheck/K1-240J [PAY-25] part-year: the bonus walks this year's checks only", () => {
    cents(takeHome(partYear()), 121_942.98, YEAR_TOLERANCE);
  });

  // $250,000 monthly (20,833.33 a check), a $100,000 bonus December 15.
  // 1c 249,999.96; 2a 241,399.96; row A 209,275, C 41,024, D 32%: 2g
  // 51,303.99; 2h 4,275.33. Wages 349,999.96: SS 11,439.00; Medicare
  // 5,075.00; Additional Medicare 0.9% × 149,999.96 = 1,350.00. Take-home
  // 349,999.96 − 12 × 4,275.33 − 22,000 − 11,439 − 5,075 − 1,350 =
  // 258,832.00 (258,832.01 by rounded checks, the verdict's figure).
  const medicare = household({
    job: {
      ...MONTHLY,
      annualSalary: "250000",
      bonusOverride: 100_000,
      bonusMonth: 12,
      bonusDayOfMonth: 15,
    },
  });
  it("paycheck/K1-250D [PAY-25] past $200,000 all year: the bonus's check pays Additional Medicare", () => {
    cents(takeHome(medicare()), 258_832.01, 0.12);
  });

  // CPA worksheet H3v: MFJ one earner, $190,000 biweekly, $30,000 bonus in
  // March. 1c 189,999.94; 1g 12,900; 2a 177,099.94; T26 MFJ row A 120,100,
  // C 11,600, D 22%: 2g 24,139.99; 2h 928.46 (24,140 a year). Take-home
  // 220,000 − 11,439 − 3,190 − 180 − 24,140 − 6,600 = 174,451.00
  // (hand-worksheet.md H3v; Additional Medicare is withheld past 200,000
  // whatever the W-4 says, IRC 3102(f)).
  const h3v = household({
    job: {
      ...BIWEEKLY,
      w4FilingStatus: "MFJ",
      annualSalary: "190000",
      bonusOverride: 30_000,
      bonusMonth: 3,
      bonusDayOfMonth: 15,
    },
  });
  it("paycheck/HW-H3v [PAY-25] MFJ one earner: the year's take-home is the schedule's", () => {
    cents(takeHome(h3v()), 174_451, YEAR_TOLERANCE);
  });
});

// ---------------------------------------------------------------------------
// N1: an over-limit HSA account is capped first (verdict N1, owner choice)
// ---------------------------------------------------------------------------

describe("paycheck/N1: the HSA cap comes before the paycheck", () => {
  // $100,000 monthly (8,333.33 a check), HSA $500 a check, self-only.
  // The 2026 self-only limit is 4,400 (Rev. Proc. 2025-19), so 4,400 / 12
  // = 366.67 a check; the excess isn't contributed (owner choice, with a
  // message: verdict N1). Box 1 100,000 − 4,400 = 95,600. Check wages
  // 8,333.33 − 366.67 = 7,966.66: 1c 95,599.92; 2a 86,999.92; T26 Single
  // row A 57,900, C 5,800, D 22%: 2g 5,800 + 22% × 29,099.92 = 12,201.98;
  // 2h 1,016.83, 12,201.96 a year. FICA wages 12 × 7,966.66 = 95,599.92
  // (PW-4.6).
  const s = household({
    job: { ...MONTHLY, annualSalary: "100000" },
    contributions: [hsa(500)],
  });
  it("paycheck/N1-reg [PAY-05] HSA 366.67 a check; federal and FICA wages without it", () => {
    const pc = s().paycheck;
    const hsaLine = pc.preTaxDeductions.find((d) => d.taxTreatment === "hsa");
    cents(
      {
        hsa: hsaLine?.amount ?? NaN,
        federalWages: s().earnings.federalWages,
        federal: pc.federalWithholding * 12,
        ficaWages: s().earnings.ficaWages,
      },
      {
        hsa: 366.67,
        federalWages: 95_600,
        federal: 12_201.96,
        ficaWages: 95_599.92,
      },
    );
  });
});

// ---------------------------------------------------------------------------
// N2: the Year-end estimate charges Additional Medicare
// ---------------------------------------------------------------------------

describe("paycheck/N2: the Year-end estimate", () => {
  // $300,000 monthly (25,000 a check). 1c 300,000; 2a 291,400; T26 Single
  // row A 263,725, C 58,448, D 35%: 2g 68,134.25; 2h 5,677.85 (68,134.20
  // a year). SS 11,439.00. Medicare 1.45% × 300,000 + 0.9% × 100,000 =
  // 5,250.00 (PW-7.1, PW-7.9). Net 300,000 − 68,134.20 − 11,439 − 5,250 =
  // 215,176.80.
  const s = household({ job: { ...MONTHLY, annualSalary: "300000" } });
  it("paycheck/N2 [PAY-24] the Year-end estimate charges Additional Medicare", () => {
    const b = s().blendedAnnual;
    cents(
      { medicare: b.ficaMedicare, net: b.netPay },
      { medicare: 5_250, net: 215_176.8 },
    );
  });
});

// ---------------------------------------------------------------------------
// N3: a part-year job's caps are sized on this year's checks
// ---------------------------------------------------------------------------

const PART_YEAR_CAPS = 'v0.11 Limits "Part-year caps" (verdict N3)';

/** The year's figures for a job that pays only from its start. */
function partYearFigures(s: Summary): Record<string, number> {
  const rows = paidRows(s);
  return {
    perCheck: s.paycheck.preTaxDeductions.reduce((a, d) => a + d.amount, 0),
    preTax: s.earnings.preTaxFederal,
    federalWages: s.earnings.federalWages,
    ficaWages: s.earnings.ficaWages,
    federal: round2(rows.reduce((a, r) => a + r.federalWithholding, 0)),
    net: takeHome(s),
  };
}

describe("paycheck/N3: part-year caps", () => {
  // $120,000 monthly from July 1: 6 checks of 10,000, HSA $500 each =
  // 3,000, under 4,400. Check wages 9,500: 1c 114,000; 2a 105,400; T26
  // Single row A 57,900, C 5,800, D 22%: 2g 16,250.00; 2h 1,354.17 (6 ×
  // = 8,125.02). Wages 57,000 for both taxes (PW-4.6, PW-4.7): SS
  // 3,534.00, Medicare 826.50. Net 60,000 − 3,000 − 8,125.02 − 3,534 −
  // 826.50 = 44,514.48. Today the cap pass sizes 12 checks and cuts the
  // row to 366.67 a check.
  const hsaJob = household({
    job: { ...MONTHLY, annualSalary: "120000", startDate: "2026-07-01" },
    contributions: [hsa(500)],
  });
  xfail({
    id: "paycheck/N3-HSA [PAY-05]",
    todo: PART_YEAR_CAPS,
    run: () => partYearFigures(hsaJob()),
    expected: {
      perCheck: 500,
      preTax: 3_000,
      federalWages: 57_000,
      ficaWages: 57_000,
      federal: 8_125.02,
      net: 44_514.48,
    },
    today: { net: 45_077.28 },
  });

  // $240,000 monthly from July 1: 6 checks of 20,000, a traditional 401(k)
  // of $3,500 each = 21,000, under 24,500. Check wages 16,500: 1c 198,000;
  // 2a 189,400; T26 Single row A 113,200, C 17,966, D 24%: 2g 36,254.00;
  // 2h 3,021.17 (6 × = 18,127.02). FICA wages 120,000 (PW-4.2): SS
  // 7,440.00, Medicare 1,740.00. Net 120,000 − 21,000 − 18,127.02 − 7,440
  // − 1,740 = 71,692.98.
  const k401 = household({
    job: { ...MONTHLY, annualSalary: "240000", startDate: "2026-07-01" },
    contributions: [
      { accountType: "401k", taxTreatment: "pre_tax", perCheck: 3_500 },
    ],
  });
  xfail({
    id: "paycheck/N3-401k [PAY-05]",
    todo: PART_YEAR_CAPS,
    run: () => partYearFigures(k401()),
    expected: { preTax: 21_000, federal: 18_127.02, net: 71_692.98 },
    today: { net: 78_342.96 },
  });
});

// ---------------------------------------------------------------------------
// N6: a bonus dated before the first payday
// ---------------------------------------------------------------------------

describe("paycheck/N6: a bonus before the first payday", () => {
  // $156,000 biweekly, first payday Friday January 9; a $40,000 bonus
  // dated January 5. Counted when paid (PW-8.1), with the first check it
  // can be: check 1.
  const jan9 = {
    ...BIWEEKLY,
    anchorPayDate: "2026-01-09",
    annualSalary: "156000",
    bonusOverride: 40_000,
    bonusMonth: 1,
    bonusDayOfMonth: 5,
  };
  const s = household({ job: jan9 });
  it("paycheck/N6-a [PAY-19] a bonus before the first payday is on check 1", () => {
    cents(s().paycheck.bonusPeriod ?? 0, 1);
  });

  // The same, year to date on August 14 (16 checks paid): the bonus is
  // paid, so the year-to-date bonus is 40,000 (the Income card's paid
  // test: bonusPeriod ≤ checks so far).
  it("paycheck/N6-b [PAY-21] year to date counts it from January", () => {
    const pc = s().paycheck;
    const paid =
      pc.bonusPeriod !== null && pc.bonusPeriod <= pc.periodsElapsedYtd;
    cents(paid ? pc.bonusEstimate.bonusGross : 0, 40_000);
  });

  // The same job started June 1: the bonus is dated before the start, so
  // it isn't this job's (paycheck.ts's own rule). Checks from June 12 to
  // December 25: 15 × 6,000 = 90,000 of income.
  const late = household({ job: { ...jan9, startDate: "2026-06-01" } });
  it("paycheck/N6-c [PAY-25] a job started later doesn't count the bonus", () => {
    cents(late().earnings.gross, 90_000);
  });
});

// ---------------------------------------------------------------------------
// N5: a 27-payday year (decision: real paydays, salary ÷ normal periods)
// ---------------------------------------------------------------------------

describe("paycheck/N5: a 27-payday year", () => {
  // Biweekly, first payday Thursday January 1, 2026: paydays January 1 to
  // December 31, 27 of them. $200,000 with a $40,000 bonus December 31:
  // the bonus is on check 27, and its FICA is walked with the year. Today
  // the schedule stops at 26 rows, the bonus on the last of them.
  const bonus = household({
    job: {
      ...BIWEEKLY,
      anchorPayDate: "2026-01-01",
      annualSalary: "200000",
      bonusOverride: 40_000,
      bonusMonth: 12,
      bonusDayOfMonth: 31,
    },
  });
  xfail({
    id: "paycheck/N5-bonus [PAY-22]",
    todo: N5,
    run: () => {
      const rows = bonus().paycheck.yearSchedule;
      return {
        rows: rows.length,
        bonusGross: round2(rows.reduce((a, r) => a + r.bonusGross, 0)),
        bonusOnLast: rows[rows.length - 1]!.bonusGross,
      };
    },
    expected: { rows: 27, bonusGross: 40_000, bonusOnLast: 40_000 },
    today: { rows: 26, bonusGross: 40_000 },
  });

  // $52,000, the same 27 paydays, the job ending December 31: 27 checks
  // of 52,000 / 26 = 2,000, gross 54,000. Gross and net must come from
  // the same checks; the net isn't worked here, so the property is held:
  // 27 rows, and the year's gross and net equal the rows' sums. Today
  // both count the schedule's 26 rows (gross 52,000; net 26 × 1,690.85 =
  // 43,962.10: 1c 52,000; 2a 43,400; T26 Single row A 19,900, C 1,240,
  // D 12%: 2h 156.15; SS 124.00; Medicare 29.00), so no 27th check.
  const ending = household({
    job: {
      ...BIWEEKLY,
      anchorPayDate: "2026-01-01",
      annualSalary: "52000",
      endDate: "2026-12-31",
    },
  });
  xfail({
    id: "paycheck/N5-end [PAY-22]",
    todo: N5,
    run: () => {
      const s = ending();
      const rows = paidRows(s);
      return {
        rows: rows.length,
        grossGap: round2(
          s.earnings.gross - rows.reduce((a, r) => a + r.gross, 0),
        ),
        netGap: round2(
          s.earnings.netRegular - rows.reduce((a, r) => a + r.netPay, 0),
        ),
        net: s.earnings.netRegular,
      };
    },
    expected: { rows: 27, grossGap: 0, netGap: 0 },
    today: { rows: 26, grossGap: 0, netGap: 0, net: 43_962.1 },
  });
});

// ---------------------------------------------------------------------------
// Y1, Y2: year to date from the checks actually paid (PW-9.5, PW-9.6)
// ---------------------------------------------------------------------------

describe("paycheck/Y1, Y2: year to date", () => {
  // $300,000 biweekly from January 2, as of July 2: 13 checks of
  // 11,538.46 (149,999.98, under the base and under 200,000). Each check:
  // SS 715.38, Medicare 167.31; FICA 13 × 882.69 = 11,474.97. Federal:
  // 1c 299,999.96; 2a 291,399.96; T26 Single row A 263,725, C 58,448,
  // D 35%: 2g 68,134.24; 2h 2,620.55. Net a check 11,538.46 − 2,620.55 −
  // 715.38 − 167.31 = 8,035.22; 13 × = 104,457.86.
  const y1 = household({
    job: { ...BIWEEKLY, annualSalary: "300000" },
    now: "2026-07-02T12:00:00Z",
  });
  it("paycheck/Y1 [PAY-33] year to date sums the checks paid, full Social Security until the base", () => {
    // annual-summary.tsx, Year to date: the schedule's checks so far.
    const pc = y1().paycheck;
    const year = yearTotals(pc.yearSchedule, 1, pc.periodsElapsedYtd);
    cents(
      {
        checks: pc.periodsElapsedYtd - pc.periodsBeforeStart,
        fica: year.fica,
        net: year.net,
      },
      { checks: 13, fica: 11_474.97, net: 104_457.86 },
    );
  });

  // $100,000 biweekly from January 2 (3,846.15 a check), a $10,000 bonus
  // March 15 (check 6), Single, as of July 2 (13 checks). The key doesn't
  // state the status or the day; any March day and Single give the same
  // figures. Federal a check: 1c 99,999.90; 2a 91,399.90; T26 Single row
  // A 57,900, C 5,800, D 22%: 2g 13,169.98; 2h 506.54; 13 × = 6,585.02,
  // plus 22% × 10,000 = 2,200: 8,785.02. FICA a check 238.46 + 55.77 =
  // 294.23; 13 × = 3,824.99, plus the bonus's 620 + 145 = 765: 4,589.99.
  const y2 = household({
    job: {
      ...BIWEEKLY,
      annualSalary: "100000",
      bonusOverride: 10_000,
      bonusMonth: 3,
      bonusDayOfMonth: 15,
    },
    now: "2026-07-02T12:00:00Z",
  });
  it("paycheck/Y2 [PAY-20] withheld so far includes the bonus check's withholding", () => {
    const pc = y2().paycheck;
    cents(withheldThroughPeriod(pc.yearSchedule, pc.periodsElapsedYtd), {
      federal: 8_785.02,
      fica: 4_589.99,
    });
  });
});

// ---------------------------------------------------------------------------
// N4: 37% on supplemental wages over $1,000,000
// ---------------------------------------------------------------------------

describe("paycheck/N4: the mandatory 37% rate", () => {
  // A $1,200,000 bonus, Single, monthly ($120,000 salary; regular wages
  // don't count toward the $1,000,000, Reg. 31.3402(g)-1(a)(2)). 22% ×
  // 1,000,000 = 220,000, plus 37% × 200,000 = 74,000: 294,000 (PW-8.3).
  // Today 22% of all of it: 264,000.
  const s = household({
    job: {
      ...MONTHLY,
      annualSalary: "120000",
      bonusOverride: 1_200_000,
      bonusMonth: 12,
      bonusDayOfMonth: 15,
    },
  });
  xfail({
    id: "paycheck/N4-1.2M [PAY-15]",
    todo: 'v0.11 Paycheck "37% supplemental over $1M" (verdict N4)',
    run: () => s().paycheck.bonusEstimate.bonusFederalWithholding,
    expected: 294_000,
    today: 264_000,
  });
});
