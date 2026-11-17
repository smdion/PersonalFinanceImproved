/**
 * Answer key, a lump sum's account part (ENG-13): the part a one-time lump
 * sum lands on, by its category and tax type. Owner decisions: a lump sum
 * names its account's side ("traditional"/"roth") and lands on that side's
 * part; a name no such part carries is shared by balance over that
 * category's parts of that tax type within the lump sum's own parent
 * (Retirement first only when unset); a lump sum no part can take is named
 * in the run's warnings. Invented households only.
 */
import { describe, expect, it } from "vitest";
import { cents } from "../../fixtures/answer-key";
import { applyLumpSums } from "@/lib/pure/engine/projection-year-handlers/lump-sum";
import { makeIndKey } from "@/lib/pure/engine/individual-accounts/ledger";
import { makeIndividualAccount } from "../fixtures/engine-fixtures";
import type { LumpSum } from "@/lib/pure/engine/types";
import { calculateProjection } from "@/lib/pure/engine";
import { toSimpleTaxMode } from "@/lib/pure/tax/simple-tax-mode";
import { acct, household } from "../fixtures/two-person-household";
import type {
  ProjectionContext,
  ProjectionLoopState,
} from "@/lib/pure/engine/projection-year-handlers/types";

const indKey = makeIndKey();
const part = (
  name: string,
  taxType: string,
  startingBalance: number,
  parentCategory = "Retirement",
  category: "ira" | "brokerage" = "ira",
) =>
  makeIndividualAccount({
    name,
    category,
    taxType,
    startingBalance,
    parentCategory,
  });

/** Applies `ls` to the parts; returns each part's balance after, by name
 *  and tax type. */
function land(
  ls: LumpSum,
  parts: ReturnType<typeof part>[],
): Record<string, number> {
  const indBalance = new Map(parts.map((p) => [indKey(p), p.startingBalance]));
  const ctx = {
    holdsAccounts: true,
    indAccounts: parts,
    indKey,
    // eslint-disable-next-line no-restricted-syntax -- test-only stub for complex engine types
  } as unknown as ProjectionContext;
  const state = {
    balances: { preTax: 0, taxFree: 0, hsa: 0, afterTax: 0, afterTaxBasis: 0 },
    accountBalance: {
      "401k": { structure: "roth_traditional", traditional: 0, roth: 0 },
      "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
      ira: { structure: "roth_traditional", traditional: 0, roth: 0 },
      hsa: { structure: "single_bucket", balance: 0 },
      brokerage: { structure: "basis_tracking", balance: 0, basis: 0 },
    },
    indBalance,
    // eslint-disable-next-line no-restricted-syntax -- test-only stub for complex engine types
  } as unknown as ProjectionLoopState;
  applyLumpSums([ls], ctx, state);
  return Object.fromEntries(
    parts.map((p) => [`${p.name} ${p.taxType}`, indBalance.get(indKey(p))!]),
  );
}

describe("answer key: the part a lump sum lands on", () => {
  it("eng/LS-1 [ENG-13] a Roth lump sum with no account named lands on a Roth part", () => {
    // An IRA held as a Traditional part (100,000) and its Roth part (0); a
    // 7,000 Roth lump sum lands on the Roth part: Roth 7,000, Traditional
    // unchanged.
    cents(
      land({ amount: 7_000, targetAccount: "ira", taxType: "roth" }, [
        part("IRA", "preTax", 100_000),
        part("IRA", "taxFree", 0),
      ]),
      { "IRA preTax": 100_000, "IRA taxFree": 7_000 },
    );
  });

  it("eng/LS-2 [ENG-13] a named Roth lump sum lands on that account's Roth part", () => {
    // Two IRAs, each in two parts; 5,000 named "IRA B", Roth side: only
    // IRA B's Roth part takes it (20,000 → 25,000).
    cents(
      land(
        {
          amount: 5_000,
          targetAccount: "ira",
          taxType: "roth",
          targetAccountName: "IRA B",
        },
        [
          part("IRA A", "preTax", 50_000),
          part("IRA A", "taxFree", 10_000),
          part("IRA B", "preTax", 80_000),
          part("IRA B", "taxFree", 20_000),
        ],
      ),
      {
        "IRA A preTax": 50_000,
        "IRA A taxFree": 10_000,
        "IRA B preTax": 80_000,
        "IRA B taxFree": 25_000,
      },
    );
  });

  it("eng/LS-3 [ENG-13] a name no part carries is shared by balance over the Retirement parts of its tax type", () => {
    // 40,000 Traditional named "Old IRA", which no part carries: the
    // Retirement IRAs' Traditional parts share it by balance, 300,000 :
    // 100,000 → 30,000 and 10,000; the Portfolio one and the Roth part
    // take nothing.
    cents(
      land(
        {
          amount: 40_000,
          targetAccount: "ira",
          taxType: "traditional",
          targetAccountName: "Old IRA",
        },
        [
          part("IRA A", "preTax", 300_000),
          part("IRA B", "preTax", 100_000),
          part("IRA B", "taxFree", 50_000),
          part("IRA P", "preTax", 200_000, "Portfolio"),
        ],
      ),
      {
        "IRA A preTax": 330_000,
        "IRA B preTax": 110_000,
        "IRA B taxFree": 50_000,
        "IRA P preTax": 200_000,
      },
    );
  });

  it("eng/LS-4 [ENG-13] a Portfolio lump sum whose named account is gone stays Portfolio money", () => {
    // 10,000 from the Brokerage page (Portfolio money) named "Old
    // Brokerage", which no part carries: the Portfolio brokerage takes it
    // (20,000 → 30,000); the Retirement brokerage keeps 400,000.
    cents(
      land(
        {
          amount: 10_000,
          targetAccount: "brokerage",
          targetAccountName: "Old Brokerage",
          targetParentCategory: "Portfolio",
        },
        [
          part(
            "Retirement Brokerage",
            "afterTax",
            400_000,
            "Retirement",
            "brokerage",
          ),
          part(
            "Portfolio Brokerage",
            "afterTax",
            20_000,
            "Portfolio",
            "brokerage",
          ),
        ],
      ),
      {
        "Retirement Brokerage afterTax": 400_000,
        "Portfolio Brokerage afterTax": 30_000,
      },
    );
  });
});

describe("answer key: a lump sum's account part through the engine", () => {
  const lumpSum = (ls: LumpSum) => ({
    accumulationOverrides: [{ year: 2027, lumpSums: [ls] }],
  });

  it("eng/LS-5 [ENG-13] Simple tax mode leaves a Portfolio lump sum whose named account is gone out of retirement money", () => {
    // LS-4's lump sum: Portfolio money, so Simple mode (retirement money
    // only) drops it.
    const input = household(
      [
        acct("Ann Brokerage", "brokerage", 400_000, 1, "afterTax"),
        {
          ...acct("Ann Portfolio", "brokerage", 20_000, 1, "afterTax"),
          parentCategory: "Portfolio",
        },
      ],
      lumpSum({
        amount: 10_000,
        targetAccount: "brokerage",
        targetAccountName: "Old Brokerage",
        targetParentCategory: "Portfolio",
      }),
    );
    const zero = { "401k": 0, "403b": 0, hsa: 0, ira: 0, brokerage: 0 };
    const simple = toSimpleTaxMode(input, {
      retirementBuckets: {
        preTax: 0,
        taxFree: 0,
        hsa: 0,
        afterTax: 400_000,
        afterTaxBasis: 400_000,
      },
      defaults: {
        baseYearContributions: zero,
        baseYearEmployerMatch: zero,
        employerMatchRateByCategory: zero,
        accountSplits: zero,
        taxSplits: {},
      },
    });
    cents(
      { lumpSums: simple.accumulationOverrides[0]!.lumpSums!.length },
      { lumpSums: 0 },
    );
  });

  it("eng/LS-6 [ENG-13] a lump sum into a kind of account the household doesn't hold is named in the run's warnings", () => {
    // 5,000 into an HSA, but the household holds only an IRA and a
    // brokerage: the totals take it, no account part can, and the run
    // says so instead of dropping it from the rows silently.
    const result = calculateProjection(
      household(
        [
          acct("Ann IRA", "ira", 400_000, 1, "preTax"),
          acct("Ann Brokerage", "brokerage", 100_000, 1, "afterTax"),
        ],
        lumpSum({ amount: 5_000, targetAccount: "hsa" }),
      ),
    );
    expect(result.warnings).toContain(
      "2027: a $5,000 lump sum for HSA has no HSA account to land in, so no account's row shows it.",
    );
  });
});
