import { describe, it, expect } from "vitest";
import { evaluateDataSources } from "@/lib/pure/data-freshness";

const now = new Date("2026-06-15T12:00:00");
const byKey = (inputs: Parameters<typeof evaluateDataSources>[0], at = now) =>
  Object.fromEntries(
    evaluateDataSources(inputs, at).map((s) => [s.source.key, s]),
  );

describe("evaluateDataSources", () => {
  it("lists only sources in use, in registry order", () => {
    const keys = evaluateDataSources(
      {
        simplefin: { lastUpdated: "2026-06-15T08:00:00.000Z" },
        balance: { lastUpdated: "2026-06-12" },
      },
      now,
    ).map((s) => s.source.key);
    expect(keys).toEqual(["balance", "simplefin"]);
  });

  it("judges each source against its own rhythm", () => {
    const s = byKey({
      balance: { lastUpdated: "2026-06-01" }, // 14 days, weekly
      performance: { lastUpdated: "2026-06-01" }, // 14 days, monthly
      simplefin: { lastUpdated: "2026-06-11T12:00:00" }, // 4 days, daily
    });
    expect(s.balance).toMatchObject({
      needsAttention: true,
      reason: "14 days old",
    });
    expect(s.performance!.needsAttention).toBe(false);
    expect(s.simplefin).toMatchObject({
      needsAttention: true,
      reason: "4 days old",
    });
  });

  it("does not call a yearly source stale before it is due", () => {
    const basis = { basis: { lastUpdated: "2025-02-01" } };
    expect(byKey(basis).basis!.needsAttention).toBe(true); // past Jan 31, not updated this year
    expect(
      byKey(basis, new Date("2026-01-20T12:00:00")).basis!.needsAttention,
    ).toBe(false);
    expect(
      byKey({ basis: { lastUpdated: "2026-01-10" } }).basis!.needsAttention,
    ).toBe(false);
    expect(
      byKey({ basis: { lastUpdated: "2025-12-31" } }).basis!.needsAttention,
    ).toBe(false);
  });

  it("flags a failed sync even when it is recent", () => {
    expect(
      byKey({
        simplefin: {
          lastUpdated: "2026-06-15T08:00:00.000Z",
          error: "Example Bank needs re-login",
        },
      }).simplefin,
    ).toMatchObject({ needsAttention: true, reason: "last sync failed" });
  });

  it("flags a connected source that never ran", () => {
    expect(byKey({ budgetApi: { lastUpdated: null } }).budgetApi).toMatchObject(
      { needsAttention: true, reason: "never synced", ageDays: null },
    );
  });

  it("turns monitor findings into attention without a sync error", () => {
    const one = byKey({
      simplefin: {
        lastUpdated: "2026-06-15T08:00:00.000Z",
        warnings: ["Example Plan: holdings last reported 9 days ago"],
      },
    }).simplefin!;
    expect(one).toMatchObject({
      needsAttention: true,
      reason: "Example Plan: holdings last reported 9 days ago",
    });
    const two = byKey({
      simplefin: {
        lastUpdated: "2026-06-15T08:00:00.000Z",
        warnings: ["a", "b"],
      },
    }).simplefin!;
    expect(two.reason).toBe("2 problems");
  });
});
