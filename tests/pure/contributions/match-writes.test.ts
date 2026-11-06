/** The one writer of match terms: a percent write stores the rate and no
 *  value (0017's end state), any other type no rate, and the bound refuses
 *  only a rate a write raises past 200%. */
import { describe, it, expect } from "vitest";
import {
  accountMatchColumns,
  entryWithMatchRate,
  matchRefused,
} from "@/lib/pure/contributions/match-writes";
import { percentFromRate } from "@/lib/utils/match-rate";

const PERCENT = "percent_of_contribution";

describe("accountMatchColumns", () => {
  it("a percent value writes its rate, and no value", () => {
    expect(
      accountMatchColumns(PERCENT, { employerMatchValue: "50" }, null),
    ).toEqual({
      employerMatchValue: null,
      employerMatchRate: "0.5",
    });
  });
  it("an incoming rate wins", () => {
    expect(
      accountMatchColumns(
        PERCENT,
        { employerMatchValue: "50", employerMatchRate: "0.035" },
        null,
      ),
    ).toEqual({ employerMatchValue: null, employerMatchRate: "0.035" });
  });
  it("a write that sends neither converts a stored value with no rate", () => {
    expect(
      accountMatchColumns(PERCENT, {}, { employerMatchValue: "60.00" }),
    ).toEqual({ employerMatchValue: null, employerMatchRate: "0.6" });
  });
  it("a value resent unchanged keeps the stored rate, and a changed one moves it", () => {
    const stored = {
      employerMatchType: PERCENT,
      employerMatchValue: null,
      employerMatchRate: "0.500000",
    };
    expect(
      accountMatchColumns(PERCENT, { employerMatchValue: null }, stored),
    ).toEqual({ employerMatchValue: null, employerMatchRate: "0.500000" });
    expect(
      accountMatchColumns(PERCENT, { employerMatchValue: "60" }, stored),
    ).toEqual({ employerMatchValue: null, employerMatchRate: "0.6" });
  });
  it("leaving percent with no value sent keeps the whole percent the rate held", () => {
    const stored = {
      employerMatchType: PERCENT,
      employerMatchValue: null,
      employerMatchRate: "0.5",
    };
    expect(accountMatchColumns("dollar_match", {}, stored)).toEqual({
      employerMatchValue: "50",
      employerMatchRate: null,
    });
    // A full update resends the stored null: the same as sending none.
    expect(
      accountMatchColumns("dollar_match", { employerMatchValue: null }, stored),
    ).toEqual({ employerMatchValue: "50", employerMatchRate: null });
    expect(
      accountMatchColumns(
        "dollar_match",
        { employerMatchValue: "500" },
        stored,
      ),
    ).toEqual({ employerMatchRate: null });
  });
  it("any other type clears the rate and leaves the value alone", () => {
    for (const type of ["dollar_match", "fixed_annual", "none", "unknown"])
      expect(
        accountMatchColumns(
          type,
          { employerMatchValue: "1000", employerMatchRate: "0.5" },
          null,
        ),
      ).toEqual({ employerMatchRate: null });
  });
  it("a value with no number writes no rate; a null rate clears both", () => {
    expect(
      accountMatchColumns(PERCENT, { employerMatchValue: "abc" }, null),
    ).toEqual({
      employerMatchValue: "abc",
      employerMatchRate: null,
    });
    expect(
      accountMatchColumns(PERCENT, { employerMatchRate: null }, null),
    ).toEqual({
      employerMatchValue: null,
      employerMatchRate: null,
    });
  });
});

describe("entryWithMatchRate", () => {
  it("an entry's own percent value gets its rate", () => {
    expect(
      entryWithMatchRate(
        { employerMatchValue: "60" },
        { type: PERCENT, value: null },
        false,
      ),
    ).toEqual({
      employerMatchRate: "0.6",
    });
  });
  it("a stale rate follows the value", () => {
    expect(
      entryWithMatchRate(
        { employerMatchValue: "60", employerMatchRate: "0.5" },
        { type: PERCENT, value: null },
        false,
      ),
    ).toEqual({ employerMatchRate: "0.6" });
  });
  it("a value resent unchanged keeps the stored rate", () => {
    const before = { employerMatchValue: "60", employerMatchRate: "0.6" };
    expect(
      entryWithMatchRate(
        { employerMatchValue: "60", employerMatchRate: "9" },
        { type: PERCENT, value: null },
        false,
        before,
      ),
    ).toEqual({ employerMatchRate: "0.6" });
  });
  it("a sent rate wins over a value", () => {
    expect(
      entryWithMatchRate(
        { employerMatchValue: "50", employerMatchRate: "0.6" },
        { type: PERCENT, value: null },
        true,
      ),
    ).toEqual({ employerMatchRate: "0.6" });
  });
  it("leaving the percent type drops the rate", () => {
    expect(
      entryWithMatchRate(
        {
          employerMatchType: "dollar_match",
          employerMatchValue: "500",
          employerMatchRate: "0.5",
        },
        { type: PERCENT, value: null },
        false,
      ),
    ).toEqual({ employerMatchType: "dollar_match", employerMatchValue: "500" });
    expect(
      entryWithMatchRate(
        { employerMatchValue: "500", employerMatchRate: "5" },
        { type: "fixed_annual", value: null },
        false,
      ),
    ).toEqual({ employerMatchValue: "500" });
  });
  it("leaving the percent type, a rate held with no value becomes its whole percent value", () => {
    expect(
      entryWithMatchRate(
        { employerMatchType: "dollar_match", employerMatchRate: "0.4" },
        { type: PERCENT, value: null },
        false,
      ),
    ).toEqual({ employerMatchType: "dollar_match", employerMatchValue: "40" });
  });
  it("an own rate with no value is the entry's own; with neither it holds no rate", () => {
    expect(
      entryWithMatchRate(
        { employerMatchType: PERCENT, employerMatchRate: "0.5" },
        { type: "fixed_annual", value: "40" },
        false,
      ),
    ).toEqual({ employerMatchType: PERCENT, employerMatchRate: "0.5" });
    expect(
      entryWithMatchRate(
        { employerMatchRate: "0.5" },
        { type: PERCENT, value: null },
        false,
      ),
    ).toEqual({ employerMatchRate: "0.5" });
    expect(
      entryWithMatchRate(
        { isActive: false },
        { type: PERCENT, value: null },
        false,
      ),
    ).toEqual({
      isActive: false,
    });
  });
  it("its own type decides, an unknown or null one included", () => {
    expect(
      entryWithMatchRate(
        { employerMatchType: PERCENT, employerMatchValue: "40" },
        undefined,
        false,
      ),
    ).toEqual({
      employerMatchType: PERCENT,
      employerMatchRate: "0.4",
    });
    expect(
      entryWithMatchRate(
        { employerMatchType: null, employerMatchValue: "40" },
        { type: PERCENT, value: null },
        false,
      ),
    ).toEqual({ employerMatchType: null, employerMatchValue: "40" });
  });
  it("a value with no number keeps no rate", () => {
    expect(
      entryWithMatchRate(
        { employerMatchValue: "" },
        { type: PERCENT, value: null },
        false,
      ),
    ).toEqual({
      employerMatchValue: "",
    });
  });
});

describe("entryWithMatchRate borrowing", () => {
  it("a percent type with no value of its own on a non-percent account takes the account's value, as 0016 fills it", () => {
    expect(
      entryWithMatchRate(
        { employerMatchType: PERCENT },
        { type: "fixed_annual", value: "40" },
        false,
      ),
    ).toEqual({ employerMatchType: PERCENT, employerMatchRate: "0.4" });
  });
  it("a rate it already holds is never baked again", () => {
    expect(
      entryWithMatchRate(
        { employerMatchType: PERCENT, employerMatchRate: "0.4" },
        { type: "fixed_annual", value: "60" },
        false,
      ),
    ).toEqual({ employerMatchType: PERCENT, employerMatchRate: "0.4" });
  });
  it("on a percent account, with no rate, it reads the account's", () => {
    expect(
      entryWithMatchRate(
        { employerMatchType: PERCENT },
        { type: PERCENT, value: "50" },
        false,
      ),
    ).toEqual({ employerMatchType: PERCENT });
  });
});

describe("a sent rate with no percent", () => {
  it.each(["100000000000", "1e11", "-100000000000", "abc"])(
    "%s is kept as sent, so it is refused",
    (rate) => {
      const cols = accountMatchColumns(
        PERCENT,
        { employerMatchRate: rate },
        null,
      );
      expect(cols.employerMatchRate).toBe(rate);
      expect(
        matchRefused(
          true,
          { rate: cols.employerMatchRate, value: cols.employerMatchValue },
          { type: PERCENT, rate: "0.5", value: "50" },
        ),
      ).toBe(true);
    },
  );
});

describe("matchRefused", () => {
  const none = { type: PERCENT, rate: null, value: null };
  const at = (rate: string | null, value: string | null = null) => ({
    type: PERCENT,
    rate,
    value,
  });
  it("refuses a rate a write sets past 2, below 0, or finer than two decimals of a percent", () => {
    expect(matchRefused(true, at("2.5"), none)).toBe(true);
    expect(matchRefused(true, at("50"), at("0.5", "50"))).toBe(true);
    expect(matchRefused(true, at("-0.1"), none)).toBe(true);
    expect(matchRefused(true, at("0.12345"), none)).toBe(true);
  });
  it("refuses a value that reads as a number but gives no rate (too large)", () => {
    expect(matchRefused(true, at(null, "100000000"), none)).toBe(true);
    expect(
      matchRefused(true, at(null, "100000000"), at(null, "100000000")),
    ).toBe(false);
    expect(matchRefused(true, at(null, "abc"), none)).toBe(false);
  });
  it("keeps 0 to 2 at two decimals of a percent, and any other type", () => {
    expect(matchRefused(true, at("2"), none)).toBe(false);
    expect(matchRefused(true, at("0.1234"), none)).toBe(false);
    expect(matchRefused(true, at("0"), none)).toBe(false);
    expect(matchRefused(false, at(null, "100000000"), none)).toBe(false);
  });
  it("keeps a rate already stored outside them, read from its rate or its whole percent", () => {
    expect(matchRefused(true, at("2.5"), at("2.5", "250"))).toBe(false);
    expect(matchRefused(true, at("3"), at(null, "300"))).toBe(false);
    expect(matchRefused(true, at("0.12345"), at(null, "12.345"))).toBe(false);
  });
  // M14 (advisor E9 F2): a dollar value is no stored rate.
  it("refuses a value kept across a switch to percent from another type", () => {
    const dollars = { type: "dollar_match", rate: null, value: "5000" };
    expect(matchRefused(true, at("50", "5000"), dollars)).toBe(true);
    expect(
      matchRefused(true, at(null, "100000000"), {
        ...dollars,
        value: "100000000",
      }),
    ).toBe(true);
    expect(
      matchRefused(true, at("50", "5000"), { ...dollars, rate: "50" }),
    ).toBe(true);
    expect(matchRefused(true, at("0.5", "50"), dollars)).toBe(false);
  });
});

describe("percentFromRate", () => {
  it.each([
    ["0.5", "50"],
    ["0.035", "3.5"],
    ["1", "100"],
    ["0.0314159", "3.14159"],
    ["0", "0"],
  ])("%s → %s", (rate, percent) => expect(percentFromRate(rate)).toBe(percent));
  it("is null where no number is read", () =>
    expect(percentFromRate("abc")).toBeNull());
});
