/** Readers take a percent match's stored rate; with none stored (a row
 *  restored or written before migration 0016 filled it), the whole percent
 *  value is read as before, so no figure moves. */
import { describe, it, expect } from "vitest";
import {
  computeEmployerMatch,
  computeGroupedEmployerMatch,
  entryWithMergedRate,
  storedMatchRate,
  type GroupableMatchRow,
} from "@/lib/pure/contributions/employer-match";
import { parseEmployerMatch } from "@/lib/pure/contributions/contribution-amount";

const PERCENT = "percent_of_contribution";

describe("parseEmployerMatch", () => {
  it("reads the stored rate", () => {
    expect(
      parseEmployerMatch(PERCENT, 50, 0.06, storedMatchRate("0.5")),
    ).toMatchObject({ rate: 0.5 });
    expect(
      parseEmployerMatch(PERCENT, 999, 0.06, storedMatchRate("0.25")),
    ).toMatchObject({ rate: 0.25 });
  });
  it("falls back to the whole percent with no rate stored", () => {
    expect(parseEmployerMatch(PERCENT, 50, 0.06, null)).toMatchObject({
      rate: 0.5,
    });
    expect(parseEmployerMatch(PERCENT, 50, 0.06)).toEqual(
      parseEmployerMatch(PERCENT, 50, 0.06, null),
    );
  });
  it("leaves dollar matches to the value", () => {
    expect(
      parseEmployerMatch("fixed_annual", 1000, 0, storedMatchRate("0.5")),
    ).toEqual({ kind: "flat", perYear: 1000 });
  });
});

describe("computeEmployerMatch", () => {
  it.each([
    [50, "0.5"],
    [100, "1"],
    [3.5, "0.035"],
    [6, "0.06"],
  ])("a %s%% value and its rate give the same match", (value, rate) => {
    const args = [
      PERCENT,
      value,
      0.06,
      6000,
      "fixed_annual",
      6000,
      100000,
    ] as const;
    expect(computeEmployerMatch(...args, storedMatchRate(rate))).toBe(
      computeEmployerMatch(...args),
    );
  });
});

describe("computeGroupedEmployerMatch", () => {
  const row = (over: Partial<GroupableMatchRow>): GroupableMatchRow => ({
    id: 1,
    jobId: 1,
    personId: 1,
    accountType: "401k",
    parentCategory: "Retirement",
    annual: 6000,
    salary: 100000,
    employerMatchType: PERCENT,
    employerMatchValue: 50,
    employerMaxMatchPct: 0.06,
    employerMatchTaxTreatment: "pre_tax",
    ...over,
  });
  it("reads the rate when one is stored", () => {
    const m = computeGroupedEmployerMatch([
      row({
        employerMatchValue: 999,
        employerMatchRate: storedMatchRate("0.5"),
      }),
    ]);
    expect(m.get(1)!.matchAnnual).toBe(3000);
  });
  it("reads the whole percent when none is", () => {
    expect(
      computeGroupedEmployerMatch([row({ employerMatchRate: null })]).get(1)!
        .matchAnnual,
    ).toBe(3000);
    expect(computeGroupedEmployerMatch([row({})]).get(1)!.matchAnnual).toBe(
      3000,
    );
  });
});

describe("storedMatchRate", () => {
  it.each([
    ["0.500000", 0.5],
    ["0.035", 0.035],
    [0.5, 0.5],
    [null, null],
    [undefined, null],
    ["", null],
    ["abc", null],
  ])("%s → %s", (stored, rate) => expect(storedMatchRate(stored)).toBe(rate));
});

describe("entryWithMergedRate", () => {
  const account = { employerMatchRate: "0.5", employerMatchValue: "50" };
  it("an entry's own rate wins", () =>
    expect(
      entryWithMergedRate(account, {
        employerMatchValue: "60",
        employerMatchRate: "0.6",
      }),
    ).toMatchObject({ employerMatchRate: "0.6" }));
  it("an entry's own value with no rate shadows the account's rate (its value is read)", () => {
    expect(
      entryWithMergedRate(account, { employerMatchValue: "fifty" }),
    ).toEqual({ employerMatchValue: "fifty", employerMatchRate: null });
    expect(
      entryWithMergedRate(account, { employerMatchValue: null }),
    ).toMatchObject({ employerMatchRate: null });
  });
  it("an entry with no value of its own reads the account's rate", () => {
    expect(
      entryWithMergedRate(account, { contributionValue: "6" }),
    ).toMatchObject({ employerMatchRate: "0.5" });
    expect(
      entryWithMergedRate({ id: 1 }, { contributionValue: "6" }),
    ).toMatchObject({ employerMatchRate: null });
  });
});
