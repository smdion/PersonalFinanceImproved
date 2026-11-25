/**
 * Answer key, a slot's money no contribution spec claims (ENG-19): the
 * household's assumed savings land on its Retirement accounts of that kind,
 * by balance; on a $0 tie, by each person's other part of the same
 * account; all $0, equally per part. Invented households only.
 */
import { describe, expect, it } from "vitest";
import { cents } from "../../fixtures/answer-key";
import { unclaimedSlot } from "@/lib/pure/engine/individual-accounts/own-part-credits";
import { makeIndKey } from "@/lib/pure/engine/individual-accounts/ledger";
import type { IndividualAccountInput } from "@/lib/pure/accounts/account-balances.types";
import type { AccumulationSlot } from "@/lib/pure/engine/types/routing";
import { withAccountId } from "../fixtures/engine-input";

const part = (
  name: string,
  category: IndividualAccountInput["category"],
  taxType: IndividualAccountInput["taxType"],
  startingBalance: number,
  ownerPersonId?: number,
  parentCategory = "Retirement",
): IndividualAccountInput =>
  withAccountId({
    name,
    category,
    taxType,
    startingBalance,
    ownerPersonId,
    parentCategory,
  });
const slot = (
  category: AccumulationSlot["category"],
  money: Partial<AccumulationSlot>,
): AccumulationSlot => ({
  category,
  irsLimit: 0,
  effectiveLimit: 0,
  employerMatch: 0,
  employeeContrib: 0,
  rothContrib: 0,
  traditionalContrib: 0,
  remainingSpace: 0,
  cappedByAccount: false,
  cappedByTaxType: false,
  overflowAmount: 0,
  ...money,
});

/** Credits `slots` over `parts`; each part's credit by name and tax type. */
function land(
  parts: IndividualAccountInput[],
  slots: AccumulationSlot[],
  overflowToBrokerage = 0,
): Record<string, number> {
  const indKey = makeIndKey();
  const indBalance = new Map(parts.map((p) => [indKey(p), p.startingBalance]));
  const indParentCat = new Map(
    parts.map((p) => [indKey(p), p.parentCategory!]),
  );
  const contributions = new Map<string, number>();
  const ledger = {
    indAccounts: parts,
    indKey,
    indBalance,
    indParentCat,
    overflowToBrokerage,
  };
  for (const s of slots) unclaimedSlot(ledger, s, contributions);
  return Object.fromEntries(
    parts.map((p) => [
      `${p.name} ${p.taxType}`,
      contributions.get(indKey(p)) ?? 0,
    ]),
  );
}

describe("answer key: a slot's money no spec claims", () => {
  it("eng/US-1 [ENG-19] splits by balance over the Retirement accounts of its kind, never a Portfolio one", () => {
    // Ann's 401(k) 300,000 and Bo's 100,000, Traditional: 8,000 pre-tax
    // lands 6,000 / 2,000. A 4,000 brokerage slot with 1,000 of it the
    // year's IRS overflow (routed apart): 3,000 to the Retirement
    // brokerage (50,000), none to the Portfolio one (200,000).
    cents(
      land(
        [
          part("Ann 401k", "401k", "preTax", 300_000, 1),
          part("Bo 401k", "401k", "preTax", 100_000, 2),
          part("Retirement brokerage", "brokerage", "afterTax", 50_000),
          part(
            "Taxable",
            "brokerage",
            "afterTax",
            200_000,
            undefined,
            "Portfolio",
          ),
        ],
        [
          slot("401k", { employeeContrib: 8_000, traditionalContrib: 8_000 }),
          slot("brokerage", { employeeContrib: 4_000 }),
        ],
        1_000,
      ),
      {
        "Ann 401k preTax": 6_000,
        "Bo 401k preTax": 2_000,
        "Retirement brokerage afterTax": 3_000,
        "Taxable afterTax": 0,
      },
    );
  });

  it("eng/US-2 [ENG-19] a $0 tie follows each person's other part of the same account", () => {
    // Both Roth parts hold $0; the Traditional parts 300,000 / 100,000:
    // 4,000 of Roth savings lands 3,000 / 1,000.
    cents(
      land(
        [
          part("Ann 401k", "401k", "preTax", 300_000, 1),
          part("Bo 401k", "401k", "preTax", 100_000, 2),
          part("Ann 401k", "401k", "taxFree", 0, 1),
          part("Bo 401k", "401k", "taxFree", 0, 2),
        ],
        [slot("401k", { employeeContrib: 4_000, rothContrib: 4_000 })],
      ),
      {
        "Ann 401k preTax": 0,
        "Bo 401k preTax": 0,
        "Ann 401k taxFree": 3_000,
        "Bo 401k taxFree": 1_000,
      },
    );
  });

  it("eng/US-3 [ENG-19] when every part of the account holds $0 too, equally per part", () => {
    // Two newly opened 401(k)s, all four parts at $0: 5,000 pre-tax
    // lands 2,500 each.
    cents(
      land(
        [
          part("Ann 401k", "401k", "preTax", 0, 1),
          part("Bo 401k", "401k", "preTax", 0, 2),
          part("Ann 401k", "401k", "taxFree", 0, 1),
          part("Bo 401k", "401k", "taxFree", 0, 2),
        ],
        [slot("401k", { employeeContrib: 5_000, traditionalContrib: 5_000 })],
      ),
      {
        "Ann 401k preTax": 2_500,
        "Bo 401k preTax": 2_500,
        "Ann 401k taxFree": 0,
        "Bo 401k taxFree": 0,
      },
    );
  });

  it("eng/US-5 [ENG-19] a part under $1 beside a $0 part blends toward the $0-tie rule, in proportion to its balance", () => {
    // E0's PW1 ruling (2026-11-24), with T the parts' total and F = $1:
    // T/F of the balance shares plus (1 - T/F) of the $0-tie shares.
    // Ann's Roth part holds $0.50 and Bo's $0, so T/F = 0.5; the $0 tie
    // follows the Traditional parts, 300,000 / 100,000 = 0.75 / 0.25.
    // Ann 0.5 x 1 + 0.5 x 0.75 = 0.875; Bo 0.5 x 0 + 0.5 x 0.25 = 0.125.
    // 4,000 of Roth savings lands 3,500 / 500 (not 4,000 / 0).
    cents(
      land(
        [
          part("Ann 401k", "401k", "preTax", 300_000, 1),
          part("Bo 401k", "401k", "preTax", 100_000, 2),
          part("Ann 401k", "401k", "taxFree", 0.5, 1),
          part("Bo 401k", "401k", "taxFree", 0, 2),
        ],
        [slot("401k", { employeeContrib: 4_000, rothContrib: 4_000 })],
      ),
      {
        "Ann 401k preTax": 0,
        "Bo 401k preTax": 0,
        "Ann 401k taxFree": 3_500,
        "Bo 401k taxFree": 500,
      },
    );
  });

  it("eng/US-4 [ENG-19] the cents left by the split go to the largest share, the earlier on a tie, so the parts hold the slot", () => {
    // 100.00 over three equal parts: 33.34, 33.33, 33.33.
    const credits = land(
      [
        part("A", "hsa", "hsa", 1_000),
        part("B", "hsa", "hsa", 1_000),
        part("C", "hsa", "hsa", 1_000),
      ],
      [slot("hsa", { employeeContrib: 100 })],
    );
    cents(credits, { "A hsa": 33.34, "B hsa": 33.33, "C hsa": 33.33 });
    expect(Object.values(credits).reduce((s, v) => s + v, 0)).toBeCloseTo(
      100,
      10,
    );
  });
});
