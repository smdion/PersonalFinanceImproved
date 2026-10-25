import { describe, it, expect } from "vitest";
import { evaluateMilestones } from "@/lib/pure/milestones";
import {
  rankRecommendations,
  recommendationsFromMilestones,
  type Recommendation,
} from "@/lib/pure/recommendations";
import { makeInput, makeSavings } from "../fixtures/milestones";

const recs = (overrides: Parameters<typeof makeInput>[0] = {}) =>
  rankRecommendations(
    recommendationsFromMilestones(evaluateMilestones(makeInput(overrides))),
  );

describe("recommendations from milestones", () => {
  it("turns Behind milestones with a next step into recommendations", () => {
    const list = recs();
    const ids = list.map((r) => r.id);
    // Fixture: 401k not maxed (step 6), savings rate 22% < 25%.
    expect(ids).toContain("foo6");
    expect(ids).toContain("savingsRate");
    // Reached, on-track and journey milestones aren't to-dos.
    expect(ids).not.toContain("foo2");
    expect(ids).not.toContain("liquidMillionaire");
    expect(ids).not.toContain("wealthFormula");
  });

  it("carries the engine's own dollars and urgency", () => {
    const list = recs({ match: { captured: 2_000, available: 3_000 } });
    const match = list.find((r) => r.id === "foo2")!;
    expect(match).toMatchObject({
      urgency: "now",
      area: "paycheck",
      impact: { kind: "perYear", amount: 1_000 },
      href: "/paycheck",
    });
    // Alerts lead.
    expect(list[0]!.id).toBe("foo2");
    const step6 = list.find((r) => r.id === "foo6")!;
    expect(step6).toMatchObject({
      urgency: "soon",
      impact: { kind: "perYear", amount: 8_500 },
    });
  });

  it("ranks by urgency, then yearly dollars, then configured order", () => {
    const r = (
      id: string,
      urgency: Recommendation["urgency"],
      amount: number | null,
      kind: "perYear" | "oneTime" = "perYear",
    ): Recommendation => ({
      id,
      area: "paycheck",
      urgency,
      title: id,
      action: id,
      context: "",
      impact: amount === null ? null : { kind, amount },
      href: "/",
      source: "moneyGuy",
    });
    const ranked = rankRecommendations([
      r("foo6", "soon", 1_000),
      r("foo5", "soon", 5_000),
      r("emergencyFund", "now", null),
      // One-time dollars never outrank yearly ones by size.
      r("savingsRate", "soon", 50_000, "oneTime"),
    ]).map((x) => x.id);
    expect(ranked).toEqual(["emergencyFund", "foo5", "foo6", "savingsRate"]);
  });

  it("nothing to do when everything is reached", () => {
    const list = recs({
      savings: makeSavings({ rate: 0.3, retirementRate: 0.3 }),
      limits: [],
      checklist: { will: true, termLife: true, healthDirective: true },
      mortgage: null,
    });
    expect(list.filter((r) => r.area === "paycheck")).toEqual([]);
  });
});

describe("recommendations that defer to a more precise one", () => {
  it("a milestone whose subjects another item covers steps aside", () => {
    const results = evaluateMilestones(
      makeInput({
        holdings: {
          coverage: 1,
          knownValue: 100_000,
          unlinkedValue: 0,
          classes: [],
          expenseRatio: 0.0005,
          costCoverage: 1,
          funds: [
            {
              name: "AAA",
              bucket: "us_equity",
              expenseRatio: 0.005,
              switchable: true,
            },
          ],
        },
      }),
    );
    const ids = (covered: string[]) =>
      recommendationsFromMilestones(results, new Set(covered)).map((r) => r.id);
    expect(ids([])).toContain("fundCosts");
    expect(ids(["AAA"])).not.toContain("fundCosts");
  });

  it("uninvested cash says which under-target classes it would rebalance", async () => {
    const { recommendationsFromCash } =
      await import("@/lib/pure/recommendations-cash");
    const drag = [
      {
        simplefinAccountId: 1,
        label: "Brokerage",
        excess: 5_000,
        value: 20_000,
      },
    ];
    expect(
      recommendationsFromCash({ drag, hsa: [], underTarget: ["Bonds"] })[0]!
        .action,
    ).toMatch(
      /— Bonds is under target, so investing it there also rebalances$/,
    );
    expect(recommendationsFromCash({ drag, hsa: [] })[0]!.action).not.toMatch(
      /under target/,
    );
  });
});
