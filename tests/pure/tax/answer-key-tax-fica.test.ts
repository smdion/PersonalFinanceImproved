/**
 * Answer key, the year's Social Security and Medicare on the Taxes page
 * (TAX-07, TAX-08) and the Additional Medicare withheld-versus-owed note
 * (TAX-10); v0.10.5 overnight batch. Worked by hand from the statute
 * first, never read from `src/`. Invented households only.
 *
 * Citations: IRC 3101(a) (6.2% on wages up to the contribution and
 * benefit base, per person: a second earner's wages never share the
 * first's base), 3121(a)(1) and the SSA's 2026 base, $184,500; 3101(b)(1)
 * (1.45%, no base); 3101(b)(2) (0.9% on wages above $250,000 MFJ,
 * $200,000 Single, combined on a joint return); 3102(f)(1) (the employer
 * withholds 0.9% only on what it pays one employee above $200,000);
 * Form 8959 instructions (2025) Part V (the difference is settled on the
 * return).
 */
import { describe, expect, it } from "vitest";
import { cents } from "../../fixtures/answer-key";
import { liabilityInput, limit } from "../fixtures/paycheck-answer-key";
import { calculateHouseholdTax } from "@/lib/pure/tax/tax";
import type { FilingStatusKey } from "@/lib/config/filing-status";
import { NO_ONE_65 } from "./tax-helpers";

/** The 2026 household tax on each person's FICA (and federal) wages. */
function household(status: FilingStatusKey, wages: number[]) {
  return calculateHouseholdTax({
    ageDeductions: NO_ONE_65,
    people: wages.map((w) => ({
      federalWages: w,
      ficaWages: w,
      hsaOutsidePayroll: 0,
    })),
    taxBrackets: liabilityInput(status),
    medicareLiabilityThreshold: limit(
      2026,
      `fica_medicare_surtax_liability_${status.toLowerCase()}`,
    ),
  });
}

describe("answer key: the year's Social Security and Medicare", () => {
  it("tax/TAX07-1 [TAX-07] Social Security per person, each to their own base", () => {
    // MFJ, $250,000 and $60,000. A: 6.2% × min(250,000, 184,500) =
    // 11,439.00; B: 6.2% × 60,000 = 3,720.00; 15,159.00 (not 6.2% of a
    // household base).
    cents(household("MFJ", [250_000, 60_000]).ficaSS, 15_159);
  });

  it("tax/TAX07-2 [TAX-07] two earners each past the base pay it twice", () => {
    // MFJ, $200,000 each: 2 × 6.2% × 184,500 = 2 × 11,439 = 22,878.00.
    cents(household("MFJ", [200_000, 200_000]).ficaSS, 22_878);
  });

  it("tax/TAX08-1 [TAX-08] Medicare on every dollar, the joint surtax above $250,000", () => {
    // MFJ, $250,000 and $60,000: 1.45% × 310,000 = 4,495.00; Additional
    // 0.9% × (310,000 − 250,000) = 540.00; Medicare 5,035.00.
    const r = household("MFJ", [250_000, 60_000]);
    cents(
      { medicare: r.ficaMedicare, additional: r.additionalMedicare },
      { medicare: 5_035, additional: 540 },
    );
  });

  it("tax/TAX08-2 [TAX-08] Single under $200,000: no surtax", () => {
    // $150,000: 1.45% × 150,000 = 2,175.00; Additional 0.
    const r = household("Single", [150_000]);
    cents(
      { medicare: r.ficaMedicare, additional: r.additionalMedicare },
      { medicare: 2_175, additional: 0 },
    );
  });
});

describe("answer key: Additional Medicare withheld against owed", () => {
  it("tax/TAX10-1 [TAX-10] two earners under $200,000 each owe it with none withheld", () => {
    // MFJ, $150,000 each: owed 0.9% × (300,000 − 250,000) = 450.00;
    // neither employer passes $200,000, withheld 0: about $450 more due.
    const note = household("MFJ", [150_000, 150_000]).warnings.find((w) =>
      w.startsWith("Additional Medicare"),
    );
    expect(note).toMatch(/about \$450 more is due/);
  });

  it("tax/TAX10-2 [TAX-10] one earner past $200,000, a spouse with none: some comes back", () => {
    // MFJ, $220,000 and $0: withheld 0.9% × 20,000 = 180.00; owed 0
    // (220,000 ≤ 250,000): about $180 comes back.
    const note = household("MFJ", [220_000, 0]).warnings.find((w) =>
      w.startsWith("Additional Medicare"),
    );
    expect(note).toMatch(/about \$180 comes back/);
  });

  it("tax/TAX10-3 [TAX-10] Single: withheld equals owed, no note", () => {
    // $260,000: withheld and owed both 0.9% × 60,000 = 540.00.
    expect(
      household("Single", [260_000]).warnings.some((w) =>
        w.startsWith("Additional Medicare"),
      ),
    ).toBe(false);
  });
});
