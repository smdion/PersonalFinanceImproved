/**
 * Where reinvested RMD money goes (fictional accounts).
 */
import { describe, it, expect } from "vitest";
import { resolveRmdExcessTarget } from "@/lib/pure/rmd-excess-target";

const perf = (id: number, parentCategory: string, over = {}) => ({
  id,
  isActive: true,
  accountType: "brokerage",
  parentCategory,
  ...over,
});
const entry = (id: number, parentCategory: string, category = "brokerage") => ({
  category,
  parentCategory,
  performanceAccountIds: [id],
});
const household = {
  entries: [
    entry(1, "Retirement"),
    entry(2, "Portfolio"),
    entry(3, "Retirement", "401k"),
  ],
  perfAccounts: [
    perf(1, "Retirement"),
    perf(2, "Portfolio"),
    perf(3, "Retirement", { accountType: "401k" }),
  ],
};

describe("resolveRmdExcessTarget", () => {
  it("no pick: the engine's default spread, no projected account", () => {
    expect(
      resolveRmdExcessTarget({
        ...household,
        targetPerformanceAccountId: null,
        reinvest: true,
      }),
    ).toEqual({
      targetPerformanceAccountId: null,
      addProjectedBrokerage: false,
      warning: null,
    });
  });

  it("a Retirement brokerage pick is honoured", () => {
    expect(
      resolveRmdExcessTarget({
        ...household,
        targetPerformanceAccountId: 1,
        reinvest: true,
      }).targetPerformanceAccountId,
    ).toBe(1);
  });

  it("a Portfolio, non-brokerage, inactive or deleted pick falls back with a warning", () => {
    for (const [id, perfAccounts] of [
      [2, household.perfAccounts],
      [3, household.perfAccounts],
      [1, [perf(1, "Retirement", { isActive: false })]],
      [9, household.perfAccounts],
    ] as const) {
      const r = resolveRmdExcessTarget({
        entries: household.entries,
        perfAccounts,
        targetPerformanceAccountId: id,
        reinvest: true,
      });
      expect(r.targetPerformanceAccountId, `pick ${id}`).toBeNull();
      expect(r.warning, `pick ${id}`).toMatch(
        /no longer a Retirement brokerage/,
      );
    }
  });

  it("no Retirement brokerage: a projection-only one when reinvesting, none when spending", () => {
    const noRetirementBrokerage = {
      entries: [entry(2, "Portfolio")],
      perfAccounts: [perf(2, "Portfolio")],
    };
    expect(
      resolveRmdExcessTarget({
        ...noRetirementBrokerage,
        targetPerformanceAccountId: null,
        reinvest: true,
      }).addProjectedBrokerage,
    ).toBe(true);
    expect(
      resolveRmdExcessTarget({
        ...noRetirementBrokerage,
        targetPerformanceAccountId: null,
        reinvest: false,
      }).addProjectedBrokerage,
    ).toBe(false);
  });
});
