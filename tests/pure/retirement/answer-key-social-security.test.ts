/**
 * Answer key, retirement: Social Security claiming, spousal benefits, COLA
 * and the claiming-age sweep (`.scratch/docs/drafts/answer-key.md`
 * § Retirement rules; rulings in `reviews/2026-11-01/rebuild/
 * retirement-verdicts.md`, rules and worked cases in
 * `reviews/2026-11-01/specs/retirement-rules.md` § 4.5, § 9 and § 14.7).
 * Ids are the spec's own, prefixed `ret/` (the same letters repeat in
 * other areas); the bracketed part is the docs/CALCULATIONS.md row.
 *
 * Every figure is worked by hand from the rule, never read from `src/`:
 * 20 CFR 404.409(a) (full retirement age by birth date), 404.410(a)
 * (worker: 5/9 of 1% a month for 36 months, then 5/12 of 1%), 404.410(b)
 * (spouse: 25/36 of 1%, then 5/12 of 1%), 404.313(b)(2) and 42 USC
 * 402(w) (2/3 of 1% a month from FRA to 70, none after), 20 CFR 404.333
 * and 42 USC 402(b)(2) (spousal base: half the worker's PIA), 402(k)(3)(A)
 * and 20 CFR 404.407(a) (the excess is reduced by the own benefit as
 * actually payable), 42 USC 402(r) (deemed filing), POMS RS 00615.020
 * (Method C), 42 USC 415(i) (COLA, from first eligibility) and the SSA
 * COLA notices (2.5% from December 2024, 2.8% from December 2025, 3.6%
 * from December 2026).
 *
 * Rounding: SSA rounds a reduction up and an increase down to the dime
 * (20 CFR 404.410(a), 404.313(b)(1)) and the PIA down to the dime after a
 * COLA (415(i)(2)(A)(ii)). Ledgr carries the unrounded percent by design
 * (spec SSB-9), so each expected figure is the unrounded amount to the
 * cent, with the SSA-rounded figure beside it.
 *
 * Money: the functions take annual amounts (PIA × 12); each case states
 * the monthly figure, as SSA does, and divides the result by 12. Claiming
 * ages are months from birth (62 = 744, 67 = 804, 70 = 840). The engine
 * claims in whole years, so S2's 59 months are reached only through the
 * multiplier (verdict U4).
 */
import { describe, expect, it } from "vitest";
import { cents } from "../../fixtures/answer-key";
import {
  fraBirthYear,
  fraToMonths,
  getFullRetirementAge,
} from "@/lib/config/social-security";
import {
  getClaimingAdjustmentMultiplier,
  computeAdjustedBenefit,
  computeSpousalBenefit,
  sweepClaimingAges,
} from "@/lib/pure/retirement/social-security";
import { socialSecurityForYear } from "@/lib/pure/engine/social-security-income";
import {
  buildSocialSecurityEntries,
  type SsPerson,
} from "@/lib/pure/retirement/social-security-entries";
import { acct, household } from "../fixtures/two-person-household";

// ---------------------------------------------------------------------------
// Inputs: invented people
// ---------------------------------------------------------------------------

/** Monthly benefit: a monthly PIA times the claiming multiplier. */
const ownMonthly = (pia: number, birthYear: number, claimMonths: number) =>
  pia *
  getClaimingAdjustmentMultiplier(getFullRetirementAge(birthYear), claimMonths);

/** A spouse's total monthly benefit: own plus any excess (Method C). */
const spouseMonthly = (
  ownPia: number,
  workerPia: number,
  birthYear: number,
  claimMonths: number,
) =>
  computeSpousalBenefit(
    computeAdjustedBenefit(ownPia * 12, birthYear, claimMonths),
    workerPia * 12,
    birthYear,
    claimMonths,
    ownPia * 12,
  ) / 12;

/** An MFJ couple as the payload builds it; monthly PIAs. */
function couple(
  worker: { birthYear: number; pia: number; claimAge: number },
  spouse: { birthYear: number; pia: number; claimAge: number },
) {
  const person = (
    personId: number,
    p: { birthYear: number; pia: number; claimAge: number },
  ): SsPerson => ({
    personId,
    name: personId === 1 ? "Worker" : "Spouse",
    birthYear: p.birthYear,
    dateOfBirth: `${p.birthYear}-06-15`,
    socialSecurityMonthly: "0",
    socialSecurityPia: String(p.pia),
    ssStartAge: p.claimAge,
  });
  return buildSocialSecurityEntries(
    [person(1, worker), person(2, spouse)],
    "MFJ",
  );
}

/** One person's monthly benefit paid in `year`, in today's dollars. */
function paidMonthly(
  entries: ReturnType<typeof couple>,
  personId: number,
  year: number,
): number {
  const paid = socialSecurityForYear(
    {
      socialSecurityEntries: entries,
      socialSecurityAnnual: 0,
      ssStartAge: 67,
      asOfDate: new Date("2026-01-01"),
    },
    year,
    0,
    1,
  );
  return (
    paid.ssIncomeByPerson!.find((p) => p.personId === personId)!.amount / 12
  );
}

// ---------------------------------------------------------------------------
// A. Full retirement age (20 CFR 404.409(a))
// ---------------------------------------------------------------------------

describe("answer key: full retirement age", () => {
  it("ret/S15 [RET-29] DOB 1960-01-02: FRA 67", () => {
    // 1/2/1960 and later: 67y 0m.
    expect(getFullRetirementAge(1960)).toEqual({ years: 67, months: 0 });
  });

  it("ret/S14 [RET-29] DOB 1960-01-01: FRA 66y 10m = 802 months", () => {
    // A person reaches an age the day before the birthday (20 CFR
    // 404.102), so 1/1/1960 is in the 1/2/1959-1/1/1960 cohort: 66y 10m =
    // 802 months, not 1960's 67y = 804 (verdict N2).
    expect(fraToMonths(getFullRetirementAge(fraBirthYear("1960-01-01")))).toBe(
      802,
    );
  });
});

// ---------------------------------------------------------------------------
// B. Claiming early or late (20 CFR 404.410(a), 404.313; 42 USC 402(w))
// ---------------------------------------------------------------------------

describe("answer key: the claiming adjustment", () => {
  it("ret/P14 [RET-30] Alex: PIA 980.50, FRA 65y 8m, 44 months early: 751.72 (CFR 404.410(a) prints 751.70)", () => {
    // Born 1941 (FRA 65y 8m = 788 months), claims at 62 (744): 44 months.
    // 36 × 5/9% = 20%; 8 × 5/12% = 3.3333%; 23.3333% of 980.50 =
    // 228.7833, so 751.7167. The regulation rounds the reduction up to
    // 228.80: 751.70.
    cents(ownMonthly(980.5, 1941, 744), 751.72);
  });

  // PIA 2,000 a month, born 1965 (FRA 67 = 804 months), unless stated.
  it("ret/S1 [RET-30] born on the 2nd, claims at 62, 60 months: 1,400.00", () => {
    // 36 × 5/9% + 24 × 5/12% = 20% + 10% = 30%: 2,000 × 0.70.
    cents(ownMonthly(2_000, 1965, 744), 1_400);
  });

  it("ret/S2 [RET-30] born on the 10th, first possible month, 59 months: 1,408.33 (SSA 1,408.30)", () => {
    // 62 throughout only from the month after the birthday month (20 CFR
    // 404.311(a)(2)): 62y 1m = 745, 59 months. 20% + 23 × 5/12% =
    // 29.5833%; reduction 591.67 (SSA: up to 591.70), so 1,408.33.
    cents(ownMonthly(2_000, 1965, 745), 1_408.33);
  });

  it("ret/S3 [RET-30] claims at 63, 48 months: 1,500.00", () => {
    // 20% + 12 × 5/12% = 25%.
    cents(ownMonthly(2_000, 1965, 756), 1_500);
  });

  it("ret/S4 [RET-30] claims at 64, 36 months: 1,600.00", () => {
    // 36 × 5/9% = 20%.
    cents(ownMonthly(2_000, 1965, 768), 1_600);
  });

  it("ret/S5 [RET-30] claims at 66, 12 months: 1,866.67 (SSA 1,866.60)", () => {
    // 12 × 5/9% = 6.6667%; reduction 133.33 (SSA: up to 133.40).
    cents(ownMonthly(2_000, 1965, 792), 1_866.67);
  });

  it("ret/S6 [RET-30] one month early: 1,988.89 (SSA 1,988.80)", () => {
    // 5/9% = 0.5556%; reduction 11.11 (SSA: up to 11.20).
    cents(ownMonthly(2_000, 1965, 803), 1_988.89);
  });

  it("ret/S7 [RET-30] at FRA: 2,000.00", () => {
    // 20 CFR 404.312(a): the PIA.
    cents(ownMonthly(2_000, 1965, 804), 2_000);
  });

  it("ret/S8 [RET-30] claims at 68, 12 credits: 2,160.00", () => {
    // 12 × 2/3% = 8%.
    cents(ownMonthly(2_000, 1965, 816), 2_160);
  });

  it("ret/S9 [RET-30] claims at 70, 36 credits: 2,480.00", () => {
    // 36 × 2/3% = 24%.
    cents(ownMonthly(2_000, 1965, 840), 2_480);
  });

  it("ret/S10 [RET-30] claims at 71: no credits past 70, 2,480.00", () => {
    // Credits stop the month before 70 (20 CFR 404.313(a)): still 24%.
    cents(ownMonthly(2_000, 1965, 852), 2_480);
  });

  // FRA 66y 8m and 66y 10m (audit RT16: 1956-1958 weren't asserted).
  it("ret/S11 [RET-30] born 1958, FRA 66y 8m, PIA 1,000, at 62: 716.67 (SSA 716.60)", () => {
    // 800 − 744 = 56 months: 20% + 20 × 5/12% = 28.3333%; reduction
    // 283.33 (SSA: up to 283.40).
    cents(ownMonthly(1_000, 1958, 744), 716.67);
  });

  it("ret/S12 [RET-30] born 1959, FRA 66y 10m, PIA 1,000, at 62: 708.33 (SSA 708.30)", () => {
    // 802 − 744 = 58 months: 20% + 22 × 5/12% = 29.1667%; reduction
    // 291.67 (SSA: up to 291.70).
    cents(ownMonthly(1_000, 1959, 744), 708.33);
  });

  it("ret/S13 [RET-30] born 1958, claims at 70, PIA 1,000: 1,266.67 (SSA 1,266.60)", () => {
    // 840 − 800 = 40 credits × 2/3% = 26.6667%; increase 266.67 (SSA:
    // down to 266.60).
    cents(ownMonthly(1_000, 1958, 840), 1_266.67);
  });
});

// ---------------------------------------------------------------------------
// C. Spousal benefits (42 USC 402(b), (k)(3)(A), (r); 20 CFR 404.330,
//    404.333, 404.407, 404.410(b); POMS RS 00615.020 Method C)
// ---------------------------------------------------------------------------

describe("answer key: spousal benefits", () => {
  it("ret/P15 [RET-31] Ashley: unreduced spousal 412.40, 28 months early: 332.21 (CFR 404.410(b) prints 332.20)", () => {
    // No own benefit; worker's PIA 824.80, half 412.40. Born 1960 (FRA
    // 804), claims at 776: 28 × 25/36% = 19.4444%; reduction 80.19 (the
    // regulation: up to 80.20), so 332.21.
    cents(computeSpousalBenefit(0, 824.8 * 12, 1960, 776) / 12, 332.21);
  });

  // Worker PIA 3,000 a month; spouse born 1965 (FRA 67), PIA 1,000.
  it("ret/S16 [RET-31] worker filed; spouse claims at 62: 1,025", () => {
    // Own 1,000 × 70% = 700. Excess ½ × 3,000 − 1,000 = 500, reduced
    // 36 × 25/36% + 24 × 5/12% = 35%: 325. Total 1,025.
    cents(spouseMonthly(1_000, 3_000, 1965, 744), 1_025);
  });

  it("ret/S17 [RET-31] same at the spouse's FRA: 1,500", () => {
    // 1,000 + 500, no reduction.
    cents(spouseMonthly(1_000, 3_000, 1965, 804), 1_500);
  });

  it("ret/S18 [RET-31] worker claimed at 70 and gets 3,720: spouse still 1,500", () => {
    // The spousal base is half the worker's PIA, not of the benefit the
    // worker's delay raised (SP-1; 20 CFR 404.333): not ½ × 3,720 = 1,860.
    // Worker born 1962 files at 70 in 2032; spouse born 1965 claims at
    // FRA in 2032, so the worker has filed.
    const [worker, spouse] = couple(
      { birthYear: 1962, pia: 3_000, claimAge: 70 },
      { birthYear: 1965, pia: 1_000, claimAge: 67 },
    );
    cents(worker!.annualAmount / 12, 3_720); // 3,000 × 1.24
    cents(spouse!.annualAmount / 12, 1_500);
  });

  it("ret/S19 [RET-31] own PIA larger than half the worker's: own only, 1,600", () => {
    // 1,600 ≥ ½ × 3,000 = 1,500: no excess (20 CFR 404.330(d)).
    cents(spouseMonthly(1_600, 3_000, 1965, 804), 1_600);
  });

  it("ret/S20 [RET-31] worker not yet filed: no spousal excess before the worker files", () => {
    // The excess waits for the worker's filing and then
    // starts (SP-2; 20 CFR 404.330). Here only the wait is checked: both
    // born 1960; the spouse claims at 66 (2026), the worker at 70 (2030).
    // In 2026 the spouse has her own only: 1,000 × (1 − 12 × 5/9%) =
    // 933.33, no excess. (What happens from 2030 is S44, S45.)
    const entries = couple(
      { birthYear: 1960, pia: 3_000, claimAge: 70 },
      { birthYear: 1960, pia: 1_000, claimAge: 66 },
    );
    cents(paidMonthly(entries, 2, 2026), 933.33);
  });

  it("ret/S21 [RET-31] deemed filing: claiming own at 62 brings the spousal excess too", () => {
    // 42 USC 402(r): filing for one is filing for both. The spouse (born
    // 1965) claims at 62 in 2027, the worker (born 1960) at 67 in 2027, so
    // the worker has filed; she set only her own claim and gets S16's
    // 1,025.
    const [, spouse] = couple(
      { birthYear: 1960, pia: 3_000, claimAge: 67 },
      { birthYear: 1965, pia: 1_000, claimAge: 62 },
    );
    cents(spouse!.annualAmount / 12, 1_025);
  });

  it("ret/S44 [RET-31] worker files at 70: 700, then 1,200 from 2035", () => {
    // Both born 1965 (FRA 67). Spouse (PIA 1,000) claims at 62 in 2027;
    // the worker (PIA 3,000) files at 70 in 2035. Until 2035 she has her
    // own 700; from the worker's filing month the excess starts (42 USC
    // 402(b)(1), 402(r)(1); POMS GN 00204.035), reduced by her months
    // before FRA at that start (402(q)(6)(A)(ii)): at 70 none, so 700 +
    // 500 = 1,200.
    const entries = couple(
      { birthYear: 1965, pia: 3_000, claimAge: 70 },
      { birthYear: 1965, pia: 1_000, claimAge: 62 },
    );
    const paid = {
      beforeFiling: paidMonthly(entries, 2, 2030),
      afterFiling: paidMonthly(entries, 2, 2035),
    };
    cents(paid, { beforeFiling: 700, afterFiling: 1_200 });
  });

  it("ret/S45 [RET-31] worker files at 64: 700, then 1,075 from 2029", () => {
    // Same, the worker files at 64 (2029). The excess starts then, with 36
    // months to her FRA: 500 × (1 − 36 × 25/36%) = 375. 700, then 1,075.
    const entries = couple(
      { birthYear: 1965, pia: 3_000, claimAge: 64 },
      { birthYear: 1965, pia: 1_000, claimAge: 62 },
    );
    const paid = {
      beforeFiling: paidMonthly(entries, 2, 2028),
      afterFiling: paidMonthly(entries, 2, 2029),
    };
    cents(paid, { beforeFiling: 700, afterFiling: 1_075 });
  });

  it("ret/S46 [RET-31] own 1,240 at 70 with credits: 1,500", () => {
    // Own PIA 1,000, claims at 70 (own 1,240 with 24% credits), worker
    // PIA 3,000 filed. The spousal amount (1,500) is reduced by the own
    // benefit as payable, credits included (402(k)(3)(A); 20 CFR
    // 404.407(a); SP-8): excess 260, total max(1,240, 1,500) = 1,500.
    cents(spouseMonthly(1_000, 3_000, 1965, 840), 1_500);
  });

  it("ret/S47 [RET-31] own 1,550 at 70 is over half the worker's: own only, 1,550", () => {
    // Own PIA 1,250 at 70: own 1,550 > 1,500, own only (402(k)(3)(A):
    // the excess less the own benefit as payable is below zero).
    cents(spouseMonthly(1_250, 3_000, 1965, 840), 1_550);
  });
});

// ---------------------------------------------------------------------------
// D. COLA (42 USC 415(i); SSA COLA notices)
// ---------------------------------------------------------------------------

describe("answer key: cost-of-living adjustments", () => {
  // A projection grows a benefit by the plan's price level from the input
  // year (RET-32); fed the year's COLA as that factor, it must give the
  // COLA'd benefit.
  const paidAt = (monthly: number, factor: number) =>
    socialSecurityForYear(
      {
        socialSecurityEntries: [
          {
            personId: 1,
            personName: "A",
            annualAmount: monthly * 12,
            startAge: 62,
            birthYear: 1960,
          },
        ],
        socialSecurityAnnual: 0,
        ssStartAge: 67,
        asOfDate: new Date("2026-01-01"),
      },
      2030,
      70,
      factor,
    ).ssIncome / 12;

  it("ret/S40 [RET-32] 1,500 in November 2025, COLA 2.8%: 1,542.00 from December 2025", () => {
    // 1,500 × 1.028 = 1,542.00 (SSA 2026 COLA, effective December 2025).
    cents(paidAt(1_500, 1.028), 1_542);
  });

  it("ret/S41 [RET-32] 2,000 in November 2026, COLA 3.6%: 2,072.00, paid January 2027", () => {
    // 2,000 × 1.036 = 2,072.00 (SSA 2027 COLA).
    cents(paidAt(2_000, 1.036), 2_072);
  });

  it("ret/S42 [RET-32] PIA 2,000 at eligibility in 2024, unclaimed: 2,183.27 for December 2026 (SSA 2,183.20)", () => {
    // COLAs run from first eligibility whether or not claimed (415(i)(2)
    // (A)(iii)): 2,000 × 1.025 × 1.028 × 1.036 = 2,183.27. SSA rounds the
    // PIA down to a dime after each COLA (415(i)(2)(A)(ii)): 2,050.00,
    // 2,107.40, 2,183.20.
    cents(paidAt(2_000, 1.025 * 1.028 * 1.036), 2_183.27);
  });
});

// ---------------------------------------------------------------------------
// E. The claiming-age sweep picks the best age (audit RT29)
// ---------------------------------------------------------------------------

describe("answer key: the claiming-age sweep", () => {
  it("ret/RT29 [RET-33] a household whose best claiming age is known: 70, then each younger age in turn", () => {
    // Single, born 1964 (62 in 2026, FRA 67), PIA 2,500 a month (30,000 a
    // year). Money: a Roth IRA of 3,000,000, no growth, no inflation,
    // spending 60,000 a year. Over 59½ the Roth draws are qualified (no
    // tax), and the benefit is never taxable: at most 37,200 a year, half
    // of it 18,600, under the 25,000 base (IRC 86(c)(1)). Spending is above
    // any benefit, so every benefit dollar is a dollar not drawn: final
    // wealth is 3,000,000 − years × 60,000 plus the benefits received.
    // Benefits received, in PIA-years, are multiplier × years paid from
    // the claim age. With `projectionEndYear` 2059 the run's last year is
    // 2058 (age 94; the engine stops a year early: engine case E7,
    // decision D10), so years paid are 95 − age: 62 0.70 × 33 = 23.10;
    // 63 0.75 × 32 = 24.00; 64 0.80 × 31 = 24.80; 65 0.8667 × 30 = 26.00;
    // 66 0.9333 × 29 = 27.07; 67 1 × 28 = 28.00; 68 1.08 × 27 = 29.16;
    // 69 1.16 × 26 = 30.16; 70 1.24 × 25 = 31.00 (e.g. 70: 3,000,000 − 33 × 60,000 +
    // 30,000 × 31.00 = 1,950,000). Strictly rising, so the best age is 70
    // and the ranking runs 70 down to 62; it is the same with the last
    // year paid (96 − age: 23.80 < 24.75 < … < 32.24), so the case holds
    // once E7 is fixed. Only the ranking is asserted. A sweep that picked
    // the worst age, or ranked by anything but final wealth, fails here.
    const input = household(
      [acct("Roth IRA", "ira", 3_000_000, 1, "taxFree")],
      {
        currentAge: 62,
        birthYear: 1964,
        retirementYear: 2025,
        projectionEndYear: 2059,
        perPersonBirthYears: [1964],
        socialSecurityEntries: undefined,
        socialSecurityAnnual: 0,
        ssStartAge: 70,
        annualExpenses: 60_000,
        filingStatus: "Single",
      },
      {
        withdrawalOrder: ["ira", "401k", "403b", "brokerage", "hsa"],
        withdrawalSplits: {
          "401k": 0,
          "403b": 0,
          ira: 1,
          brokerage: 0,
          hsa: 0,
        },
        withdrawalTaxPreference: { ira: "roth" },
      },
    );
    const result = sweepClaimingAges({
      input,
      personId: 1,
      pia: 30_000,
      dateOfBirth: "1964-06-15",
    });
    expect(result.candidates.some((c) => c.fails)).toBe(false);
    expect(result.recommendedAge).toBe(70);
    expect(result.candidates.map((c) => c.claimingAge)).toEqual([
      70, 69, 68, 67, 66, 65, 64, 63, 62,
    ]);
  });
});

// ── Blocked, with an item that unblocks them ────────────────────────────

describe("answer key: Social Security cases blocked on a feature", () => {
  // Inputs and figures for each are in the spec's § 14.1 and § 14.7.
  // Survivor benefits (SV-1 to SV-9; decision E2):
  const SURVIVOR =
    'v0.11 Retirement rules "Add: survivor benefit and first death"';
  it.todo(`ret/P16: blocked on ${SURVIVOR} (survivor benefit)`);
  it.todo(`ret/P19: blocked on ${SURVIVOR} (survivor benefit)`);
  it.todo(`ret/S22: blocked on ${SURVIVOR} (survivor benefit)`);
  it.todo(`ret/S23: blocked on ${SURVIVOR} (survivor benefit)`);
  it.todo(`ret/S24: blocked on ${SURVIVOR} (survivor benefit)`);
  it.todo(`ret/S25: blocked on ${SURVIVOR} (survivor benefit)`);
  it.todo(`ret/S26: blocked on ${SURVIVOR} (survivor benefit)`);
  it.todo(`ret/S27: blocked on ${SURVIVOR} (survivor benefit)`);
  it.todo(`ret/S28: blocked on ${SURVIVOR} (survivor benefit)`);

  // The earnings test (ET-1 to ET-9; decision E5), in the same item:
  const EARNINGS_TEST = `${SURVIVOR} (earnings test, decision E5)`;
  it.todo(`ret/P20: blocked on ${EARNINGS_TEST}`);
  it.todo(`ret/S29: blocked on ${EARNINGS_TEST}`);
  it.todo(`ret/S30: blocked on ${EARNINGS_TEST}`);
  it.todo(`ret/S31: blocked on ${EARNINGS_TEST}`);
  it.todo(`ret/S32: blocked on ${EARNINGS_TEST}`);
  it.todo(`ret/S33: blocked on ${EARNINGS_TEST}`);
  it.todo(`ret/S34: blocked on ${EARNINGS_TEST}`);
  it.todo(`ret/S35: blocked on ${EARNINGS_TEST}`);
  it.todo(`ret/S36: blocked on ${EARNINGS_TEST}`);
  it.todo(`ret/S37: blocked on ${EARNINGS_TEST}`);
  it.todo(`ret/S38: blocked on ${EARNINGS_TEST}`);
  it.todo(`ret/S39: blocked on ${EARNINGS_TEST}`);
  // P27, P28 (SSA27): the 2027 exempt amounts, 670 × 72,800.33 ÷
  // 22,935.42 = 2,126.68 → 2,130 a month (25,560 a year) and 2,500 ×
  // 72,800.33 ÷ 32,154.82 = 5,660.14 → 5,660 (67,920), rounded to the
  // nearest 10 (42 USC 403(f)(8)(B)). They also need 2027's tax data.
  it.todo(`ret/P27: blocked on ${EARNINGS_TEST} and 2027 tax data`);
  it.todo(`ret/P28: blocked on ${EARNINGS_TEST} and 2027 tax data`);

  // P11 (Pub 590-B p.35): a Roth contribution's clock starts January 1 of
  // its tax year (ROTH-5), which needs K-F's five-year clock. P12 (Pub
  // 590-B pp.16-17, Rose): IRA pro rata, which needs IRA basis.
  it.todo(
    'ret/P11: blocked on v0.11 Retirement rules "Retirement rules the skeptic confirmed" (K-F)',
  );
  it.todo('ret/P12: blocked on v0.11 Retirement rules "No IRA basis input"');
});
