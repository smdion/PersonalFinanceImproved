/**
 * OBBBA senior deduction: $6,000/person 65+, 2025-2028, phased out 6% of MAGI over $75k/$150k MFJ,
 * on top of §63(f). Folded into the standard deduction before routing, with last year's MAGI as
 * the phaseout basis (this year's isn't known yet), so decumulation year 1 gets $0.
 */

import type { ReturnFilingStatus } from "@/lib/config/filing-status";
import { requireLimit } from "@/lib/pure/tax/tax-limits";

type ObbbaSeniorDeductionInput = {
  /** Household members 65+ in the projection year this deduction applies to. */
  seniorCount: number;
  /** Prior year's MAGI — the phaseout basis. Unknown in decumulation year 1
   *  (no MAGI history exists yet) ⇒ $0 deduction that year only. */
  magi: { kind: "known"; value: number } | { kind: "unknown" };
  /** $6,000/person per the statute — from `contribution_limits`
   *  (`obbba_senior_deduction_per_person`). Undefined ⇒ not seeded for this
   *  tax year ⇒ $0 (same convention as every other deduction figure here). */
  perPerson: number | undefined;
  /** Filing-status-resolved phaseout start ($150k MFJ / $75k Single/HoH/MFS)
   *  — from `contribution_limits`. */
  phaseoutStart: number | undefined;
  /** 6% per the statute — from `contribution_limits`
   *  (`obbba_senior_deduction_phaseout_rate`). */
  phaseoutRate: number | undefined;
  /** The projection year this deduction is being computed for. */
  year: number;
  /** Last year the deduction is authorized, from `contribution_limits`
   *  (`obbba_senior_deduction_sunset_year`). Undefined (not seeded) ⇒ $0. */
  sunsetYear: number | undefined;
};

/**
 * The OBBBA deduction reduces the TOTAL claimed amount (perPerson x
 * seniorCount), not each person's share independently — the 6% phaseout
 * applies once against the combined base, per the statute's own worksheet.
 */
export function computeObbbaSeniorDeduction(
  input: ObbbaSeniorDeductionInput,
): number {
  const {
    seniorCount,
    magi,
    perPerson,
    phaseoutStart,
    phaseoutRate,
    year,
    sunsetYear,
  } = input;
  if (
    seniorCount <= 0 ||
    perPerson == null ||
    phaseoutStart == null ||
    phaseoutRate == null ||
    magi.kind === "unknown" ||
    sunsetYear == null ||
    year > sunsetYear
  ) {
    return 0;
  }
  const base = perPerson * seniorCount;
  const reduction = phaseoutRate * Math.max(0, magi.value - phaseoutStart);
  return Math.max(0, base - reduction);
}

/** A return's figures that turn on who is on it, from the tax year's
 *  limits: the basic deduction, the §63(f) add-on per 65+ person, and the
 *  senior deduction's terms. */
export type ReturnDeductionTerms = {
  basic: number | undefined;
  addOnPerCondition: number | undefined;
  senior: Omit<ObbbaSeniorDeductionInput, "seniorCount" | "magi" | "year">;
};

/**
 * A tax year's deduction terms for a filing status, from its limits. The
 * basic deduction and the §63(f) add-on are published every year, so a
 * missing row throws; the senior deduction's rows end at its sunset.
 */
export function returnDeductionTerms(
  limits: Record<string, number>,
  filingStatus: ReturnFilingStatus | null,
): ReturnDeductionTerms {
  return {
    basic: filingStatus
      ? requireLimit(limits, `standard_deduction_${filingStatus.toLowerCase()}`)
      : undefined,
    addOnPerCondition: filingStatus
      ? requireLimit(
          limits,
          filingStatus === "MFJ"
            ? "additional_std_deduction_65_married"
            : "additional_std_deduction_65_unmarried",
        )
      : undefined,
    senior: {
      perPerson: limits["obbba_senior_deduction_per_person"],
      phaseoutStart: filingStatus
        ? filingStatus === "MFJ"
          ? limits["obbba_senior_deduction_phaseout_start_mfj"]
          : limits["obbba_senior_deduction_phaseout_start_unmarried"]
        : undefined,
      phaseoutRate: limits["obbba_senior_deduction_phaseout_rate"],
      sunsetYear: limits["obbba_senior_deduction_sunset_year"],
    },
  };
}

/**
 * The deduction a return takes: line 12e (the basic deduction plus the
 * §63(f) add-on for each person 65+) and the senior deduction (Schedule
 * 1-A Part V, line 13b) on the given MAGI.
 */
type ReturnDeductionsInput = {
  terms: ReturnDeductionTerms;
  over65: number;
  magi: ObbbaSeniorDeductionInput["magi"];
  year: number;
};
export function returnDeductions(
  input: ReturnDeductionsInput & { terms: { basic: number } },
): { standardDeduction: number; seniorDeduction: number };
export function returnDeductions(input: ReturnDeductionsInput): {
  standardDeduction: number | undefined;
  seniorDeduction: number;
};
export function returnDeductions(input: ReturnDeductionsInput): {
  standardDeduction: number | undefined;
  seniorDeduction: number;
} {
  const { terms, over65 } = input;
  // The add-on applies only with a basic deduction: undefined stays undefined.
  const addOn =
    terms.basic != null && terms.addOnPerCondition
      ? over65 * terms.addOnPerCondition
      : 0;
  return {
    standardDeduction: terms.basic != null ? terms.basic + addOn : terms.basic,
    seniorDeduction: computeObbbaSeniorDeduction({
      ...terms.senior,
      seniorCount: over65,
      magi: input.magi,
      year: input.year,
    }),
  };
}
