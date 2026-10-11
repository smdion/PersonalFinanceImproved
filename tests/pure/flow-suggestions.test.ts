/** Performance / basis suggestions from transactions. Invented figures only. */
import { describe, it, expect } from "vitest";
import {
  attributeFeeds,
  flowsSinceFill,
  initialBaseline,
  reduceBasis,
  splitContributions,
  sumFlows,
  type FeedAccount,
  type FlowRow,
} from "@/lib/pure/flow-suggestions";

const row = (
  id: number,
  posted: string,
  amount: number,
  kind: FlowRow["kind"],
  transfer: FlowRow["transfer"] = null,
) => ({ id, posted, amount, kind, transfer, pending: false, voided: false });

describe("sumFlows", () => {
  it("maps kinds onto the Performance fields", () => {
    const t = sumFlows([
      row(1, "2026-02-01", 500, "contribution"),
      row(2, "2026-02-02", -40, "withdrawal"),
      row(3, "2026-02-03", -2.5, "fee"),
      row(4, "2026-02-04", 12, "dividend"),
      row(5, "2026-02-05", 300, "transfer", { conversion: true }),
      row(6, "2026-02-06", -100, "transfer"),
    ]);
    expect(t).toEqual({
      contributions: 500,
      distributions: 40,
      fees: 2.5,
      rollovers: 200,
      transfersOut: 100,
      unmatchedTransfers: -100,
      conversionsIn: 300,
      latestConversionYear: 2026,
      count: 5,
    });
  });
});

describe("flowsSinceFill", () => {
  it("counts new settled rows after the baseline and records them", () => {
    const r = flowsSinceFill(
      [
        row(1, "2026-03-01", 100, "contribution"), // on the baseline day
        row(2, "2026-03-05", 200, "contribution"),
        { ...row(3, "2026-03-06", 50, "contribution"), pending: true },
        row(4, "2026-03-07", 9, "other"), // no kind yet
      ],
      {},
      "2026-03-01",
    );
    expect(r.totals.contributions).toBe(200);
    expect(r.counted).toEqual({ 2: "contribution" });
  });

  it("still counts a late arrival dated before the last fill", () => {
    const r = flowsSinceFill(
      [
        row(2, "2026-03-05", 200, "contribution"),
        row(9, "2026-03-04", 70, "contribution"),
      ],
      { 2: "contribution" },
      "2026-03-01",
    );
    expect(r.totals.contributions).toBe(70);
    expect(r.counted).toEqual({ 9: "contribution" });
  });

  it("corrects a counted row whose kind changed, and takes back a voided one", () => {
    const r = flowsSinceFill(
      [
        row(2, "2026-03-05", 200, "transfer"),
        { ...row(3, "2026-03-06", -30, "fee"), voided: true },
      ],
      { 2: "contribution", 3: "fee" },
      "2026-03-01",
    );
    expect(r.totals).toMatchObject({
      contributions: -200,
      rollovers: 200,
      fees: -30,
    });
    expect(r.counted).toEqual({ 2: "transfer", 3: "removed" });
  });
});

describe("splitContributions", () => {
  const mix = {
    employeePreTax: 3000,
    employeeRoth: 3000,
    employeeOther: 0,
    employer: 2000,
    employerRoth: 0,
  };

  it("keeps everything as the employee's without a paycheck setup", () => {
    expect(splitContributions(900, null, true)).toEqual({
      employee: 900,
      employer: 0,
      employeeRoth: 900,
      estimated: false,
    });
  });

  it("splits by the setup's proportions and says so", () => {
    expect(splitContributions(1000, mix, false)).toEqual({
      employee: 750,
      employer: 250,
      employeeRoth: 375,
      estimated: true,
    });
  });

  it("leaves an employer Roth match out of a Roth account's basis", () => {
    expect(
      splitContributions(
        800,
        { ...mix, employer: 1000, employerRoth: 1000 },
        true,
      ),
    ).toEqual({
      employee: 600,
      employer: 200,
      employeeRoth: 600,
      estimated: true,
    });
  });
});

describe("reduceBasis", () => {
  it("takes withdrawals from contributions first, then conversions, never below zero", () => {
    expect(
      reduceBasis({ contributionBasis: 100, conversionBasis: 50 }, 120),
    ).toEqual({
      contributionBasis: 0,
      conversionBasis: 30,
    });
    expect(
      reduceBasis({ contributionBasis: 100, conversionBasis: 50 }, 500),
    ).toEqual({
      contributionBasis: 0,
      conversionBasis: 0,
    });
  });
});

describe("initialBaseline", () => {
  it("starts a fresh year at its beginning and keeps a save inside the year", () => {
    expect(initialBaseline(2026, "2026-01-15", true)).toBe("2025-12-31");
    expect(initialBaseline(2026, "2026-08-16", false)).toBe("2026-08-16");
    expect(initialBaseline(2026, "2027-01-03", false)).toBe("2026-12-31");
    expect(initialBaseline(2026, null, false)).toBe("2025-12-31");
  });
});

describe("attributeFeeds", () => {
  const feed = (
    id: number,
    subKey: string | null,
    owner: number | null,
    balance = 100,
  ): FeedAccount => ({
    id,
    performanceAccountId: 7,
    subKey,
    ownerPersonId: owner,
    balance,
  });
  const subs = [
    { key: "a", performanceAccountId: 7, ownerPersonId: 1 },
    { key: "b", performanceAccountId: 7, ownerPersonId: 2 },
  ];

  it("gives a single-row account every feed and the full balance", () => {
    expect(
      attributeFeeds(
        { performanceAccountId: 7, ownerPersonId: null },
        1,
        [feed(1, null, null, 250)],
        subs,
      ),
    ).toEqual({ status: "linked", feedIds: [1], balance: 250 });
  });

  it("splits a per-person account by sub-account owner", () => {
    const feeds = [feed(1, "a", 1, 10), feed(2, "b", 2, 20)];
    expect(
      attributeFeeds(
        { performanceAccountId: 7, ownerPersonId: 2 },
        2,
        feeds,
        subs,
      ),
    ).toEqual({
      status: "linked",
      feedIds: [2],
      balance: 20,
    });
  });

  it("can't split a whole-account link across people", () => {
    expect(
      attributeFeeds(
        { performanceAccountId: 7, ownerPersonId: 1 },
        2,
        [feed(1, null, null)],
        subs,
      ).status,
    ).toBe("ambiguous");
  });

  it("leaves the balance out when part of the row isn't linked", () => {
    expect(
      attributeFeeds(
        { performanceAccountId: 7, ownerPersonId: null },
        1,
        [feed(1, "a", 1)],
        subs,
      ).balance,
    ).toBeNull();
  });

  it("reports no feed for an unlinked account", () => {
    expect(
      attributeFeeds(
        { performanceAccountId: 8, ownerPersonId: 1 },
        1,
        [feed(1, null, null)],
        subs,
      ).status,
    ).toBe("none");
  });
});
