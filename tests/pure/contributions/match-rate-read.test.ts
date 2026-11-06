/** Readers take a percent match's stored rate; with none stored (a row
 *  restored or written before migration 0016 filled it), the whole percent
 *  value is read as before, so no figure moves. */
import { describe, it, expect } from "vitest";
import {
  computeEmployerMatch,
  computeGroupedEmployerMatch,
  entryWithMergedRate,
  mergedMatchRate,
  storedMatchRate,
  type GroupableMatchRow,
} from "@/lib/pure/contributions/employer-match";
import { parseEmployerMatch } from "@/lib/pure/contributions/contribution-amount";
import {
  entryMatchFigure,
  formatEmployerMatch,
  matchFigureForForm,
  rowMatchValue,
} from "@/lib/pure/contributions/match-display";
import { accountMatchColumns } from "@/lib/pure/contributions/match-writes";
import { rateFromPercent } from "@/lib/utils/match-rate";
import { roundToCents } from "@/lib/utils/math";

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

// M13: a whole percent a double can't hold exactly. Its rate's own double
// (0.6667) differs from 66.67 / 100 in the last bit, which moves these
// figures by a cent; the stored rate reads as the value did.
describe("a non-dyadic percent reads as its value did, to the cent", () => {
  it.each([
    [66.67, 42500, 1700.09],
    [14.3, 41250, 353.93],
    [4.1, 40250, 99.01],
  ])("%s%% to a 6%% cap on $%s: $%s", (percent, salary, figure) => {
    const args = [
      PERCENT,
      percent,
      0.06,
      salary * 0.06,
      "combined",
      0,
      salary,
    ] as const;
    const { employerMatchRate } = accountMatchColumns(
      PERCENT,
      { employerMatchValue: String(percent) },
      null,
    );
    expect(employerMatchRate).toBe(rateFromPercent(percent));
    const fromRate = computeEmployerMatch(
      ...args,
      storedMatchRate(employerMatchRate),
    );
    expect(fromRate).toBe(computeEmployerMatch(...args));
    expect(roundToCents(fromRate)).toBe(figure);
    // PostgreSQL gives the rate at scale 6 ("0.666700"): the same read.
    expect(storedMatchRate(`${employerMatchRate}00`)).toBe(percent / 100);
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

describe("the form and display read the rate", () => {
  it("formatEmployerMatch shows the rate's percent, else the value", () => {
    expect(formatEmployerMatch(PERCENT, "50.00", "0.06", "0.500000")).toBe(
      formatEmployerMatch(PERCENT, "50.00", "0.06"),
    );
    expect(formatEmployerMatch(PERCENT, null, "0.06", "0.035")).toBe(
      formatEmployerMatch(PERCENT, "3.5", "0.06"),
    );
    expect(formatEmployerMatch(PERCENT, "50", 0, null)).toBe("50%");
    expect(formatEmployerMatch("fixed_annual", "1000", 0, "0.5")).toBe(
      formatEmployerMatch("fixed_annual", "1000", 0),
    );
  });
  it("matchFigureForForm keeps the stored value, and shows the rate's percent with none", () => {
    expect(matchFigureForForm(PERCENT, "50.00", "0.5")).toBe("50.00");
    expect(matchFigureForForm(PERCENT, null, "0.035")).toBe("3.5");
    expect(matchFigureForForm(PERCENT, null, null)).toBe("");
    expect(matchFigureForForm("fixed_annual", null, "0.5")).toBe("");
  });
  it("mergedMatchRate is the rate the merge gives", () => {
    expect(
      mergedMatchRate(
        { employerMatchRate: "0.5" },
        { employerMatchValue: "60" },
      ),
    ).toBeNull();
    expect(mergedMatchRate({ employerMatchRate: "0.5" }, {})).toBe("0.5");
  });
});

describe("a match held as a rate alone (0017's percent rows) still shows", () => {
  it("entryMatchFigure: an entry's own value, else its own rate; null with neither", () => {
    expect(entryMatchFigure(PERCENT, { employerMatchValue: "40" })).toBe("40");
    expect(
      entryMatchFigure(PERCENT, {
        employerMatchValue: null,
        employerMatchRate: "0.4",
      }),
    ).toBe("40");
    expect(entryMatchFigure(PERCENT, { employerMatchRate: "50" })).toBe("5000");
    expect(entryMatchFigure(PERCENT, {})).toBeNull();
    expect(entryMatchFigure(PERCENT, { employerMatchValue: null })).toBe("");
  });
  it("rowMatchValue resends the value, else the rate's whole percent, which writes back the same rate", () => {
    const row = (value: string | null, rate: string | null) => ({
      employerMatchType: PERCENT,
      employerMatchValue: value,
      employerMatchRate: rate,
    });
    expect(rowMatchValue(row("50.00", "0.500000"))).toBe("50.00");
    expect(rowMatchValue(row(null, "0.666700"))).toBe("66.67");
    expect(rowMatchValue(row(null, null))).toBeNull();
    expect(
      rowMatchValue({
        ...row("1000", null),
        employerMatchType: "fixed_annual",
      }),
    ).toBe("1000");
    for (const rate of ["0.6667", "0.035", "1", "0.143"])
      expect(
        accountMatchColumns(
          PERCENT,
          { employerMatchValue: rowMatchValue(row(null, rate)) },
          null,
        ).employerMatchRate,
      ).toBe(rate);
  });
});
