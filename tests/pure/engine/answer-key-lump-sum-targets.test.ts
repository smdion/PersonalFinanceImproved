/**
 * Answer key, a lump sum's account part (ENG-13): the part a one-time lump
 * sum lands on, by its category and tax type. Owner decisions: a lump sum
 * names its account's side ("traditional"/"roth") and lands on that side's
 * part; a name no such part carries is shared by balance over that
 * category's parts of that tax type within the lump sum's own parent
 * (Retirement first only when unset); a lump sum no part can take lands on
 * a projected part of its kind, declared at the start. A saved lump sum's
 * account id picks its part before its name (J3); with no id, its name picks
 * one part or none (J15, J43). Invented households only.
 */
import { describe, expect, it } from "vitest";
import { cents } from "../../fixtures/answer-key";
import { applyLumpSums } from "@/lib/pure/engine/projection-year-handlers/lump-sum";
import { makeIndKey } from "@/lib/pure/engine/individual-accounts/ledger";
import { makeIndividualAccount } from "../fixtures/engine-fixtures";
import type { IndividualAccountInput } from "@/lib/pure/accounts/account-balances.types";
import type { LumpSum } from "@/lib/pure/engine/types";
import { calculateProjection, resolveLumpSums } from "@/lib/pure/engine";
import { lumpSumTargetOf } from "@/lib/pure/engine/lump-sum-targets";
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
  category: "ira" | "401k" | "brokerage" = "ira",
  ids: Partial<IndividualAccountInput> = {},
) =>
  makeIndividualAccount({
    name,
    category,
    taxType,
    startingBalance,
    parentCategory,
    ...ids,
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
    // Resolved over the parts, as `resolveLumpSums` does for each run.
    lumpSumTargets: new Map([[ls, lumpSumTargetOf(ls, parts)]]),
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
    parts.map((p) => [
      `${p.name}${p.ownerName ? ` (${p.ownerName})` : ""} ${p.taxType}`,
      indBalance.get(indKey(p))!,
    ]),
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

  it("eng/LS-6 [ENG-13] a lump sum into a kind of account the household doesn't hold lands on a projected part of that kind", () => {
    // 5,000 into an HSA, but the household holds only an IRA and a
    // brokerage: the opening state declares a projected HSA part
    // (Retirement money, the lump sum names no parent), so the year's HSA
    // row holds it, as the HSA total does, and no warning is needed.
    const result = calculateProjection(
      household(
        [
          acct("Ann IRA", "ira", 400_000, 1, "preTax"),
          acct("Ann Brokerage", "brokerage", 100_000, 1, "afterTax"),
        ],
        {
          decumulationOverrides: [
            { year: 2027, lumpSums: [{ amount: 5_000, targetAccount: "hsa" }] },
          ],
        },
      ),
    );
    const year = result.projectionByYear.find((y) => y.year === 2027)!;
    const rows = year.individualAccountBalances.filter(
      (r) => r.category === "hsa",
    );
    expect(rows.map((r) => r.name)).toEqual(["Retirement HSA (projected)"]);
    // It lands after the year's growth: both hold the 5,000.
    cents(
      { row: rows[0]!.balance, hsa: year.balanceByTaxType.hsa },
      { row: 5_000, hsa: 5_000 },
    );
    expect(result.warnings.filter((w) => w.includes("lump sum"))).toEqual([]);
  });
});

describe("answer key: a saved lump sum's account by id (LS1)", () => {
  // Two IRAs in two parts each, held jointly: "IRA A" (account 11) and
  // "IRA B" (account 12).
  const iras = () => [
    part("IRA A", "preTax", 50_000, "Retirement", "ira", {
      performanceAccountId: 11,
    }),
    part("IRA A", "taxFree", 10_000, "Retirement", "ira", {
      performanceAccountId: 11,
    }),
    part("IRA B", "preTax", 150_000, "Retirement", "ira", {
      performanceAccountId: 12,
    }),
    part("IRA B", "taxFree", 20_000, "Retirement", "ira", {
      performanceAccountId: 12,
    }),
  ];

  it("eng/LS-7 [ENG-13] a lump sum whose account was renamed lands on its saved account", () => {
    // 8,000 Traditional saved for "Old IRA name", account 12, joint: account
    // 12 is now "IRA B", so its Traditional part takes it (150,000 →
    // 158,000). By the name alone it matched no part and was shared over
    // both Traditional parts by balance (2,000 and 6,000).
    cents(
      land(
        {
          amount: 8_000,
          targetAccount: "ira",
          taxType: "traditional",
          targetAccountName: "Old IRA name",
          targetPerformanceAccountId: 12,
          targetOwnerPersonId: null,
        },
        iras(),
      ),
      {
        "IRA A preTax": 50_000,
        "IRA A taxFree": 10_000,
        "IRA B preTax": 158_000,
        "IRA B taxFree": 20_000,
      },
    );
  });

  it("eng/LS-8 [ENG-13] a lump sum aimed at an unlinked account lands on that account's own part", () => {
    // J43 (a): "Old 401k" is a snapshot row with no performance account
    // (row 7), so the saved id is null; 3,000 Traditional lands on that
    // row's part (40,000 → 43,000), the linked 401k keeps 60,000.
    cents(
      land(
        {
          amount: 3_000,
          targetAccount: "401k",
          taxType: "traditional",
          targetAccountName: "Old 401k",
          targetPerformanceAccountId: null,
        },
        [
          part("Old 401k", "preTax", 40_000, "Retirement", "401k", {
            portfolioAccountId: 7,
          }),
          part("Work 401k", "preTax", 60_000, "Retirement", "401k", {
            performanceAccountId: 21,
          }),
        ],
      ),
      { "Old 401k preTax": 43_000, "Work 401k preTax": 60_000 },
    );
  });

  it("eng/LS-9 [ENG-13] a lump sum saved with no id field is matched by its name, as a null id", () => {
    // A restore that skipped the ladder leaves no id field: 5,000 Roth named
    // "IRA B" lands on IRA B's Roth part (20,000 → 25,000).
    cents(
      land(
        {
          amount: 5_000,
          targetAccount: "ira",
          taxType: "roth",
          targetAccountName: "IRA B",
        },
        iras(),
      ),
      {
        "IRA A preTax": 50_000,
        "IRA A taxFree": 10_000,
        "IRA B preTax": 150_000,
        "IRA B taxFree": 25_000,
      },
    );
  });

  it("eng/LS-10 [ENG-13] a saved account no part has any more is shared by balance within its parent, not matched by name", () => {
    // Account 99 is gone; its lump sum still reads "IRA B". The id is the
    // account, so no name match: 4,000 Traditional is shared over the
    // Retirement Traditional parts, 50,000 : 150,000 → 1,000 and 3,000.
    cents(
      land(
        {
          amount: 4_000,
          targetAccount: "ira",
          taxType: "traditional",
          targetAccountName: "IRA B",
          targetPerformanceAccountId: 99,
          targetOwnerPersonId: null,
        },
        iras(),
      ),
      {
        "IRA A preTax": 51_000,
        "IRA A taxFree": 10_000,
        "IRA B preTax": 153_000,
        "IRA B taxFree": 20_000,
      },
    );
  });

  it("eng/LS-11 [ENG-13] a name two owners' parts share, with no owner named, is shared by balance within its parent", () => {
    // A brokerage held in Ann's (30,000) and Bo's (10,000) parts, picked
    // with no owner, so its id is null: the name picks no single part, so
    // 8,000 is shared over the Retirement brokerages by balance (J15),
    // 30,000 : 10,000 : 40,000 → 3,000, 1,000 and 4,000.
    const owner = (ownerPersonId: number, ownerName: string) => ({
      performanceAccountId: 31,
      ownerPersonId,
      ownerName,
    });
    cents(
      land(
        {
          amount: 8_000,
          targetAccount: "brokerage",
          targetAccountName: "Shared Brokerage",
          targetPerformanceAccountId: null,
        },
        [
          part(
            "Shared Brokerage",
            "afterTax",
            30_000,
            "Retirement",
            "brokerage",
            owner(1, "Ann"),
          ),
          part(
            "Shared Brokerage",
            "afterTax",
            10_000,
            "Retirement",
            "brokerage",
            owner(2, "Bo"),
          ),
          part(
            "Other Brokerage",
            "afterTax",
            40_000,
            "Retirement",
            "brokerage",
            {
              performanceAccountId: 32,
            },
          ),
        ],
      ),
      {
        "Shared Brokerage (Ann) afterTax": 33_000,
        "Shared Brokerage (Bo) afterTax": 11_000,
        "Other Brokerage afterTax": 44_000,
      },
    );
  });

  it("eng/LS-12 [ENG-13] a saved account with no owner id reads as held jointly", () => {
    // Account 12 is Ann's part only; the lump sum stores id 12 and no owner,
    // so it names the joint part, which no part is: 4,000 Traditional is
    // shared, 150,000 : 50,000 → 3,000 and 1,000.
    cents(
      land(
        {
          amount: 4_000,
          targetAccount: "ira",
          taxType: "traditional",
          targetAccountName: "IRA B",
          targetPerformanceAccountId: 12,
        },
        [
          part("IRA B", "preTax", 150_000, "Retirement", "ira", {
            performanceAccountId: 12,
            ownerPersonId: 1,
            ownerName: "Ann",
          }),
          part("IRA C", "preTax", 50_000, "Retirement", "ira", {
            performanceAccountId: 13,
          }),
        ],
      ),
      { "IRA B (Ann) preTax": 153_000, "IRA C preTax": 51_000 },
    );
  });

  it("eng/LS-13 [ENG-13] through the engine, a renamed saved account's lump sum lands on its part, and only an unresolved one is reported", () => {
    // Ann's IRA (Traditional 400,000) is saved as account 41 under an old
    // name; 10,000 in 2027 lands on its Traditional part. A second lump sum
    // (2,000) names an account no part carries: only it is reported (J15).
    const ira = {
      ...acct("Ann IRA", "ira", 400_000, 1, "preTax"),
      performanceAccountId: 41,
    };
    const input = household([ira], {
      decumulationOverrides: [
        {
          year: 2027,
          lumpSums: [
            {
              amount: 10_000,
              targetAccount: "ira",
              taxType: "traditional",
              targetAccountName: "Ann Old IRA",
              targetPerformanceAccountId: 41,
              targetOwnerPersonId: 1,
            },
            {
              amount: 2_000,
              targetAccount: "ira",
              targetAccountName: "Gone IRA",
              targetPerformanceAccountId: null,
            },
          ],
        },
      ],
    });
    expect(resolveLumpSums(input).unresolved).toEqual([
      {
        year: 2027,
        category: "ira",
        amount: 2_000,
        reason: "nameMatchesNone",
      },
    ]);
    // Both land on Ann's only Traditional IRA part (the unresolved one by
    // J15, as its parent's only part): 12,000 more than without them.
    const balanceIn = (run: typeof input) =>
      calculateProjection(run)
        .projectionByYear.find((y) => y.year === 2027)!
        .individualAccountBalances.find(
          (r) => r.performanceAccountId === 41 && r.taxType === "preTax",
        )!.balance;
    cents(
      { added: balanceIn(input) - balanceIn(household([ira])) },
      { added: 12_000 },
    );
  });

  it("eng/LS-14 [ENG-13] Simple tax mode judges a saved lump sum by its saved account, so one saved to a renamed Portfolio account stays out of retirement money", () => {
    // Ann's Retirement IRA (account 51) and her Portfolio IRA (account 52,
    // since renamed). A Changes-by-year lump sum (no parent set) saved to
    // account 52 under its old name lands on the Portfolio IRA, so Simple
    // mode (retirement money only) drops it. By the name alone it matched
    // no part and went to the Retirement IRA (Retirement first), so Simple
    // kept it.
    const input = household(
      [
        { ...acct("Ann IRA", "ira", 300_000, 1), performanceAccountId: 51 },
        {
          ...acct("Ann Portfolio IRA", "ira", 100_000, 1),
          performanceAccountId: 52,
          parentCategory: "Portfolio",
        },
      ],
      {
        decumulationOverrides: [
          {
            year: 2027,
            lumpSums: [
              {
                amount: 6_000,
                targetAccount: "ira",
                taxType: "traditional",
                targetAccountName: "Ann Old Portfolio IRA",
                targetPerformanceAccountId: 52,
                targetOwnerPersonId: 1,
              },
            ],
          },
        ],
      },
    );
    const zero = { "401k": 0, "403b": 0, hsa: 0, ira: 0, brokerage: 0 };
    const simple = toSimpleTaxMode(input, {
      retirementBuckets: {
        preTax: 300_000,
        taxFree: 0,
        hsa: 0,
        afterTax: 0,
        afterTaxBasis: 0,
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
      { lumpSums: simple.decumulationOverrides[0]!.lumpSums!.length },
      { lumpSums: 0 },
    );
  });
});
