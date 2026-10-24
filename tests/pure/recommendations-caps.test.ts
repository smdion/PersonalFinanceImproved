/** IRS-limit recommendations — adapter over the cap pass's verdicts. */
import { describe, it, expect } from "vitest";
import { recommendationsFromCaps } from "@/lib/pure/recommendations-caps";
import { rankRecommendations } from "@/lib/pure/recommendations";

const over = "$11,500 over the IRS limit — set it to at most 20.41% of pay.";
const owner = "IRS limits are per person — choose who owns this account.";

describe("recommendationsFromCaps", () => {
  it("an over-limit contribution is a now item on the paycheck", () => {
    const [r] = recommendationsFromCaps([
      {
        personName: "Avery",
        accountTypes: [
          { accountType: "401k", overBy: 11500, capMessages: [over] },
          { accountType: "IRA", overBy: 0, capMessages: [] },
        ],
      },
    ]);
    expect(r).toMatchObject({
      id: "irsCap:Avery:401k",
      area: "paycheck",
      urgency: "now",
      title: "Avery: 401k contributions over the IRS limit",
      action: over,
      href: "/paycheck",
    });
  });

  it("a missing owner or coverage comes soon; joint accounts have no person", () => {
    const [r] = recommendationsFromCaps([
      {
        personName: null,
        accountTypes: [{ accountType: "IRA", overBy: 0, capMessages: [owner] }],
      },
    ]);
    expect(r).toMatchObject({ id: "irsCap:joint:IRA", urgency: "soon" });
    expect(r!.title).toBe("IRA needs a detail to size its IRS limit");
  });

  it("ranks ahead of soon items", () => {
    const recs = recommendationsFromCaps([
      {
        personName: null,
        accountTypes: [{ accountType: "HSA", overBy: 0, capMessages: [owner] }],
      },
      {
        personName: "Avery",
        accountTypes: [{ accountType: "401k", overBy: 1, capMessages: [over] }],
      },
    ]);
    expect(rankRecommendations(recs)[0]!.urgency).toBe("now");
  });
});
