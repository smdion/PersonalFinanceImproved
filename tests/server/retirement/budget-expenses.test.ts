/* eslint-disable no-restricted-syntax -- partial fixtures cast to Drizzle row types */
import "../../routers/setup-mocks";
import { describe, it, expect } from "vitest";
import { resolvePhaseExpenses } from "@/server/retirement/payload/budget-expenses";

type Profiles = Parameters<typeof resolvePhaseExpenses>[1]["allBudgetProfiles"];
type Items = Parameters<typeof resolvePhaseExpenses>[1]["allBudgetItems"];

const profiles = [
  { id: 1, isActive: true, columnLabels: ["Base"], columnMonths: null },
  { id: 2, isActive: false, columnLabels: ["Base"], columnMonths: null },
] as unknown as Profiles;
const items = [
  { id: 1, profileId: 1, amounts: [1000], contributionAccountId: null },
  { id: 2, profileId: 2, amounts: [5000], contributionAccountId: null },
] as unknown as Items;

const run = (opts: Parameters<typeof resolvePhaseExpenses>[1]["opts"]) =>
  resolvePhaseExpenses({} as never, {
    allBudgetProfiles: profiles,
    allBudgetItems: items,
    globalActiveCol: 0,
    opts,
  });

describe("resolvePhaseExpenses with a budget profile id that no longer exists", () => {
  it("falls back to the active profile instead of $0, for both phases", async () => {
    const r = await run({
      accumulationBudgetProfileId: 999,
      decumulationBudgetProfileId: 999,
    });
    expect(r.accProfile?.id).toBe(1);
    expect(r.decProfile?.id).toBe(1);
    expect(r.accumulationExpenses).toBeGreaterThan(0);
    expect(r.decumulationExpenses).toBe(r.accumulationExpenses);
  });

  it("still honors an id that exists", async () => {
    const r = await run({ decumulationBudgetProfileId: 2 });
    expect(r.decProfile?.id).toBe(2);
    expect(r.decumulationExpenses).toBeGreaterThan(r.accumulationExpenses);
  });
});
