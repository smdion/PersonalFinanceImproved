/**
 * A feed SimpleFIN still lists whose balance date stopped: stale once it
 * trails the other institutions' newest by more than two calendar days.
 */
import { describe, it, expect } from "vitest";
import { STALE_FEED_DAYS, staleFeeds } from "@/lib/pure/sync/stale-feeds";
import { staleFeedMessages } from "@/lib/pure/sync/stale-feed-message";

// The latest sync, Nov 6 08:50 Chicago (13:50 UTC).
const SYNC = new Date("2026-11-06T13:50:00Z");
const feed = (
  id: number,
  orgName: string,
  balanceAt: string,
  over: Partial<{
    isIncluded: boolean;
    linkedLoanId: number | null;
    lastSeenAt: Date;
  }> = {},
) => ({
  id,
  orgName,
  isIncluded: true,
  linkedLoanId: null,
  lastBalanceDate: new Date(balanceAt),
  lastSeenAt: SYNC,
  ...over,
});
const fidelity = feed(1, "Fidelity Investments", "2026-11-06T06:00:00Z");
// Frozen at Nov 1 15:37 Chicago, still listed in every sync.
const voya = feed(2, "Voya Financial", "2026-11-01T20:37:00Z");

describe("staleFeeds", () => {
  it("the Voya case: listed every sync, balance stuck at Nov 1", () => {
    expect(staleFeeds([fidelity, voya])).toEqual([
      { id: 2, institution: "Voya Financial", balanceDay: "2026-11-01" },
    ]);
    expect(STALE_FEED_DAYS).toBe(2);
  });

  it("two days behind is not yet stale; three is", () => {
    const two = feed(2, "Voya Financial", "2026-11-04T20:00:00Z");
    const three = feed(2, "Voya Financial", "2026-11-03T20:00:00Z");
    expect(staleFeeds([fidelity, two])).toEqual([]);
    expect(staleFeeds([fidelity, three])).toHaveLength(1);
  });

  it("one institution: its own last seen stands in", () => {
    expect(staleFeeds([voya])).toEqual([
      { id: 2, institution: "Voya Financial", balanceDay: "2026-11-01" },
    ]);
    expect(
      staleFeeds([feed(1, "Fidelity Investments", "2026-11-05T21:00:00Z")]),
    ).toEqual([]);
  });

  it("all fresh: nothing", () => {
    expect(
      staleFeeds([fidelity, feed(2, "Voya Financial", "2026-11-05T21:00:00Z")]),
    ).toEqual([]);
  });

  it("an excluded feed is ignored, both as stale and as the comparison", () => {
    expect(staleFeeds([fidelity, { ...voya, isIncluded: false }])).toEqual([]);
    // Only the excluded feed is fresh: Voya has no one to trail but itself.
    expect(
      staleFeeds([{ ...fidelity, isIncluded: false }, voya]).map((s) => s.id),
    ).toEqual([2]);
    expect(
      staleFeeds([
        { ...fidelity, isIncluded: false },
        { ...voya, lastSeenAt: new Date("2026-11-02T12:00:00Z") },
        feed(3, "Ally Bank", "2026-11-06T06:00:00Z", {
          lastSeenAt: new Date("2026-11-02T12:00:00Z"),
        }),
      ]),
    ).toEqual([]);
  });

  it("a feed the latest sync didn't list is not stale by this rule", () => {
    const gone = { ...voya, lastSeenAt: new Date("2026-11-02T12:00:00Z") };
    expect(staleFeeds([fidelity, gone])).toEqual([]);
  });

  it("a loan feed reports monthly and is never compared", () => {
    expect(staleFeeds([fidelity, { ...voya, linkedLoanId: 7 }])).toEqual([]);
  });
});

describe("staleFeedMessages", () => {
  it("one line per institution, from its newest balance", () => {
    expect(
      staleFeedMessages([
        { id: 2, institution: "Voya Financial", balanceDay: "2026-11-01" },
        { id: 3, institution: "Voya Financial", balanceDay: "2026-10-31" },
      ]),
    ).toEqual([
      {
        institution: "Voya Financial",
        message:
          "Voya hasn't updated since Nov 1: reconnect it in SimpleFIN Bridge",
      },
    ]);
  });
});
