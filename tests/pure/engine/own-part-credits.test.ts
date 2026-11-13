import { describe, expect, it } from "vitest";
import { ownPartCredits } from "@/lib/pure/engine/individual-accounts/own-part-credits";
import type { IndividualAccountInput } from "@/lib/pure/accounts/account-balances.types";
import { makeContributionSpec } from "../fixtures/engine-fixtures";
import type { AccumulationSlot } from "@/lib/pure/engine/types/routing";

const part = (
  category: IndividualAccountInput["category"],
  taxType: string,
): IndividualAccountInput => ({
  name: `${category} ${taxType}`,
  category,
  taxType,
  startingBalance: 0,
  parentCategory: "Retirement",
  origin: "synthetic",
});
const parts = [
  part("401k", "preTax"),
  part("401k", "taxFree"),
  part("hsa", "hsa"),
  part("brokerage", "afterTax"),
];
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
const slots = [
  slot("401k", {
    employeeContrib: 10000,
    traditionalContrib: 6000,
    rothContrib: 4000,
    employerMatch: 3000,
  }),
  slot("hsa", { employeeContrib: 4000, employerMatch: 500 }),
  slot("brokerage", { employeeContrib: 2000 }),
];
const byName = (credits: ReturnType<typeof ownPartCredits>) => {
  const out: Record<string, number> = {};
  for (const [p, amount] of credits ?? [])
    out[p.name] = (out[p.name] ?? 0) + amount;
  return out;
};

describe("ownPartCredits (EN14 rule 5)", () => {
  it("credits each slot to its own part by the category totals' split", () => {
    expect(byName(ownPartCredits(slots, 1200, undefined, parts))).toEqual({
      "401k preTax": 9000,
      "401k taxFree": 4000,
      "hsa hsa": 4500,
      "brokerage afterTax": 2000 + 1200,
    });
  });

  it("applies only when no part is held and there are no specs", () => {
    const held = [...parts, { ...part("ira", "preTax"), origin: undefined }];
    expect(ownPartCredits(slots, 0, undefined, held)).toBeUndefined();
    expect(ownPartCredits(slots, 0, undefined, [])).toBeUndefined();
    const spec = makeContributionSpec();
    expect(ownPartCredits(slots, 0, [spec], parts)).toBeUndefined();
    expect(ownPartCredits(slots, 0, [], parts)).toBeDefined();
  });
});
