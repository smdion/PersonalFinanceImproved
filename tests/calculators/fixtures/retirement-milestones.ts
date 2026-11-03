/**
 * Named first-RMD-year and first-claim-year checks for the engine snapshot
 * fixtures (retirement behavior baseline, v0.10.0).
 *
 * Today a skipped first RMD year (one person or a couple) or an unpaid
 * claim year is caught only because snapshot totals move (retirement
 * audit RT06, RT07, RT27); regenerate the snapshots with `-u` and it
 * passes. These checks take the expected year from the fixture's own
 * inputs by the rules below, never from the snapshot or from `src/`, so
 * `-u` can't hide it.
 *
 * Ages follow the engine's two paths, as they work today:
 * - Household (no per-person Social Security entries with tracked
 *   accounts): the age is `currentAge` plus the years since `asOfDate`,
 *   the RMD start age comes from `birthYear`, Social Security starts at
 *   `ssStartAge`.
 * - Per person (`socialSecurityEntries` and `individualAccounts`): each
 *   person's age is the year less their birth year, against their own RMD
 *   start age and claim age.
 * A start before the first projected year shows in the first year.
 */
import { expect } from "vitest";
import type {
  ProjectionInput,
  ProjectionResult,
} from "@/lib/calculators/types";

/**
 * RMD start age by birth year, hand-keyed: SECURE 2.0 Act § 107 (IRC
 * § 401(a)(9)(C)(v)): 73 for those born 1951-1959, 75 for 1960 and later;
 * 72 for 1950 and earlier (SECURE Act § 114, already past 72 when SECURE
 * 2.0 took effect).
 */
export function secure2RmdStartAge(birthYear: number): number {
  if (birthYear <= 1950) return 72;
  if (birthYear <= 1959) return 73;
  return 75;
}

/** The first projected year with an RMD due. */
export function firstRmdYear(result: ProjectionResult): number | null {
  const row = result.projectionByYear.find(
    (y) => y.phase === "decumulation" && y.rmdAmount > 0,
  );
  return row?.year ?? null;
}

/** The first projected year Social Security is paid. */
export function firstClaimYear(result: ProjectionResult): number | null {
  const row = result.projectionByYear.find(
    (y) =>
      (y.phase === "decumulation" ? y.ssIncome : (y.gapDraw?.ssIncome ?? 0)) >
      0,
  );
  return row?.year ?? null;
}

/** The years the inputs say the first RMD and first claim fall in. */
export function expectedFirstYears(input: ProjectionInput): {
  rmd: number;
  claim: number;
} {
  const asOfYear = input.asOfDate.getFullYear();
  const entries = input.socialSecurityEntries ?? [];
  const atLeastNow = (year: number) => Math.max(asOfYear, year);
  if (entries.length > 0 && (input.individualAccounts?.length ?? 0) > 0)
    return {
      rmd: Math.min(
        ...entries.map((e) =>
          atLeastNow(e.birthYear + secure2RmdStartAge(e.birthYear)),
        ),
      ),
      claim: Math.min(
        ...entries
          .filter((e) => e.annualAmount > 0)
          .map((e) => atLeastNow(e.birthYear + e.startAge)),
      ),
    };
  if (input.birthYear == null)
    throw new Error("A household fixture needs a birthYear for its RMDs");
  const yearAtAge = (age: number) =>
    atLeastNow(asOfYear + age - input.currentAge);
  return {
    rmd: yearAtAge(secure2RmdStartAge(input.birthYear)),
    claim: yearAtAge(input.ssStartAge),
  };
}

/**
 * Pins current behavior: the projection's first RMD year and first claim
 * year are the ones the fixture's inputs give.
 */
export function expectFirstRmdAndClaimYears(
  result: ProjectionResult,
  input: ProjectionInput,
): void {
  const expected = expectedFirstYears(input);
  expect(firstRmdYear(result), "first RMD year").toBe(expected.rmd);
  expect(firstClaimYear(result), "first claim year").toBe(expected.claim);
}
