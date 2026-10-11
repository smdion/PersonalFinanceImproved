/** Fund composition from N-PORT holdings. Invented holdings only. */
import { describe, it, expect } from "vitest";
import {
  isFundHolding,
  classifyByTags,
  composeFund,
  normalizeSeriesName,
  EMPTY_BUCKETS,
  type NportHolding,
} from "@/lib/pure/sec-composition";

const h = (over: Partial<NportHolding>): NportHolding => ({
  name: "Example Corp",
  lei: null,
  pctVal: 10,
  assetCat: "EC",
  invCountry: "US",
  payoffProfile: "Long",
  ...over,
});

describe("classifyByTags", () => {
  it.each([
    [{ assetCat: "EC", invCountry: "US" }, "us_equity"],
    [{ assetCat: "EP", invCountry: "JP" }, "intl_equity"],
    [{ assetCat: "DBT", invCountry: "US" }, "us_bond"],
    [{ assetCat: "ABS-MBS", invCountry: "US" }, "us_bond"],
    [{ assetCat: "DBT", invCountry: "DE" }, "intl_bond"],
    [{ assetCat: "STIV", invCountry: "US" }, "cash"],
    [{ assetCat: "DE", invCountry: null }, "other"],
  ] as const)("%o → %s", (tags, bucket) => {
    expect(classifyByTags(tags)).toBe(bucket);
  });
});

describe("composeFund", () => {
  it("sums long holdings into buckets, normalised", () => {
    const c = composeFund(
      [
        h({ pctVal: 60 }),
        h({ pctVal: 30, invCountry: "GB" }),
        h({ pctVal: 10, assetCat: "DBT" }),
        h({ pctVal: 5, payoffProfile: "Short" }), // ignored
        h({ pctVal: -2 }), // ignored
      ],
      () => ({ kind: "security" }),
    );
    expect(c.us_equity).toBeCloseTo(0.6);
    expect(c.intl_equity).toBeCloseTo(0.3);
    expect(c.us_bond).toBeCloseTo(0.1);
    expect(c.coverage).toBe(1);
  });

  it("looks through a fund holding using the underlying fund's own composition", () => {
    const bondFund = { ...EMPTY_BUCKETS, us_bond: 0.9, cash: 0.1, coverage: 1 };
    const c = composeFund(
      [h({ pctVal: 50, name: "Example Bond Fund" }), h({ pctVal: 50 })],
      (i) =>
        i === 0
          ? { kind: "fund", composition: bondFund }
          : { kind: "security" },
    );
    expect(c.us_bond).toBeCloseTo(0.45);
    expect(c.cash).toBeCloseTo(0.05);
    expect(c.us_equity).toBeCloseTo(0.5);
  });

  it("leaves an unconfirmed fund unresolved instead of guessing", () => {
    const c = composeFund(
      [h({ pctVal: 40 }), h({ pctVal: 60, name: "Example Fund" })],
      (i) => (i === 1 ? { kind: "unresolved_fund" } : { kind: "security" }),
    );
    expect(c.coverage).toBeCloseTo(0.4);
    expect(c.us_equity).toBe(1); // of what's known
  });
});

describe("normalizeSeriesName", () => {
  it("matches registry spellings regardless of case and punctuation", () => {
    expect(normalizeSeriesName("EXAMPLE TOTAL BOND MARKET II INDEX FUND")).toBe(
      normalizeSeriesName("Example Total Bond Market II Index Fund"),
    );
    expect(normalizeSeriesName("S&amp;P 500 Index")).toBe("s&p 500 index");
  });
});

describe("isFundHolding", () => {
  it("recognises SEC's registered-fund tag, but treats money market funds as cash", () => {
    expect(isFundHolding({ issuerCat: "RF", assetCat: "EC" })).toBe(true);
    expect(isFundHolding({ issuerCat: "RF", assetCat: "STIV" })).toBe(false);
    expect(isFundHolding({ issuerCat: "CORP", assetCat: "EC" })).toBe(false);
    expect(isFundHolding({ assetCat: "EC" })).toBe(false);
  });
});
