/**
 * An account part saved below $0 is covered once, at the start, by the parts
 * of its own category side and parent (Retirement or Portfolio), by balance;
 * what they can't cover counts as $0 and is named in the run's warnings.
 * Never across parents, and never again at a later year end.
 */
import { describe, expect, it } from "vitest";
import { calculateProjection } from "@/lib/pure/engine";
import { coverNegativeParts } from "@/lib/pure/engine/opening-cover";
import type { IndividualAccountInput } from "@/lib/pure/accounts/account-balances.types";
import { acct, household } from "../fixtures/two-person-household";
import { withAccountIds } from "../fixtures/engine-input";

const AS_OF_YEAR = 2026;

const brokerage = (
  name: string,
  balance: number,
  parentCategory: "Retirement" | "Portfolio",
): IndividualAccountInput => ({
  ...acct(name, "brokerage", balance, 1, "afterTax"),
  parentCategory,
});

/** The cover alone, on parts given their fixture account ids. */
const cover = (parts: IndividualAccountInput[]) =>
  coverNegativeParts(withAccountIds(parts)).parts;

/** Three working years at 0% with no pay, spending or contributions, so
 *  every balance reads as entered unless something moves it. */
function run(accounts: IndividualAccountInput[]) {
  const result = calculateProjection(
    household(accounts, {
      retirementYear: AS_OF_YEAR + 3,
      annualExpenses: 0,
    }),
  );
  const years = result.projectionByYear.filter(
    (y) => y.phase === "accumulation",
  );
  const balance = (y: number, name: string) =>
    years[y]!.individualAccountBalances.find((r) => r.name === name)!.balance;
  return { result, years, balance };
}

describe("an account part saved below $0", () => {
  it("is covered by its own parent's parts once, never by the other parent's, over three working years", () => {
    const { years, balance } = run([
      brokerage("Ann Brokerage", 50_000, "Retirement"),
      brokerage("Ann Taxable", 10_000, "Portfolio"),
      brokerage("Ann Margin", -2_000, "Portfolio"),
    ]);
    expect(years).toHaveLength(3);
    for (let y = 0; y < 3; y++) {
      expect(balance(y, "Ann Brokerage")).toBe(50_000);
      expect(balance(y, "Ann Taxable")).toBe(8_000);
      expect(balance(y, "Ann Margin")).toBe(0);
    }
  });

  it("is covered by its siblings of one parent, by balance", () => {
    const { result, balance } = run([
      brokerage("Ann Brokerage", 30_000, "Retirement"),
      brokerage("Ann Second Brokerage", 10_000, "Retirement"),
      brokerage("Ann Margin", -2_000, "Retirement"),
    ]);
    expect(balance(0, "Ann Brokerage")).toBe(28_500);
    expect(balance(0, "Ann Second Brokerage")).toBe(9_500);
    expect(balance(0, "Ann Margin")).toBe(0);
    expect(result.warnings.join("\n")).not.toMatch(/below \$0/);
  });

  it("with no sibling to cover it, counts as $0 and is named with the amount", () => {
    const { result, balance } = run([
      brokerage("Ann Brokerage", 50_000, "Retirement"),
      brokerage("Ann Margin", -2_000, "Portfolio"),
    ]);
    expect(balance(0, "Ann Brokerage")).toBe(50_000);
    expect(balance(2, "Ann Brokerage")).toBe(50_000);
    expect(balance(0, "Ann Margin")).toBe(0);
    const notes = result.warnings.filter((w) => w.includes("below $0"));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/^Ann Margin is saved below \$0.*\$2000\.00/);
  });

  it("raised to $0, holds no basis, so its siblings' basis ratio stays theirs", () => {
    const [taken, raised] = cover([
      {
        ...brokerage("Ann Brokerage", 10_000, "Retirement"),
        startingBasis: 6_000,
      },
      {
        ...brokerage("Ann Margin", -2_000, "Retirement"),
        startingBasis: 5_000,
      },
    ]);
    expect(taken).toMatchObject({
      startingBalance: 8_000,
      startingBasis: 4_800,
    });
    expect(raised).toMatchObject({ startingBalance: 0, startingBasis: 0 });
  });

  it("raised to $0, holds no Roth basis to take out tax-free", () => {
    const meta = {
      year: AS_OF_YEAR,
      contributionBasis: 3_000,
      conversionBasis: 1_000,
      latestConversionYear: null,
      isSeeded: true,
      updatedAt: "2026-03-07",
    };
    const [, raised] = cover([
      acct("Ann Roth IRA", "ira", 5_000, 1, "taxFree"),
      {
        ...acct("Ann Old Roth IRA", "ira", -1_000, 1, "taxFree"),
        rothBasisMeta: meta,
      },
    ]);
    expect(raised!.startingBalance).toBe(0);
    expect(raised!.rothBasisMeta).toMatchObject({
      contributionBasis: 0,
      conversionBasis: 0,
    });
  });

  it("covered in part, names only what's left", () => {
    const { result, balance } = run([
      brokerage("Ann Taxable", 1_500, "Portfolio"),
      brokerage("Ann Margin", -2_000, "Portfolio"),
    ]);
    expect(balance(0, "Ann Taxable")).toBe(0);
    expect(balance(0, "Ann Margin")).toBe(0);
    const notes = result.warnings.filter((w) => w.includes("below $0"));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/\$500\.00/);
  });
});
