/** IRS-limit recommendations — adapter over the cap pass's verdicts. */
import { describe, it, expect } from "vitest";
import { recommendationsFromCaps } from "@/lib/pure/recommendations-caps";
import { rankRecommendations } from "@/lib/pure/recommendations";
import { applyDismissals } from "@/lib/pure/recommendation-dismissals";

const over = "$11,500 over the IRS limit — set it to at most 20.41% of pay.";
const owner = "IRS limits are per person — choose who owns this account.";
const t = (
  accountType: string,
  categoryKey: string,
  overBy: number,
  capMessages: string[],
) => ({ accountType, categoryKey, overBy, capMessages });

describe("recommendationsFromCaps", () => {
  it("an over-limit contribution is a snooze-only now item on the paycheck", () => {
    const [r] = recommendationsFromCaps(
      [
        {
          personId: 7,
          personName: "Avery",
          accountTypes: [
            t("401(k)", "401k", 11500, [over]),
            t("IRA", "ira", 0, []),
          ],
        },
      ],
      2030,
    );
    expect(r).toMatchObject({
      id: "irsCap:7:401k:2030",
      area: "paycheck",
      urgency: "now",
      title: "Avery: 401(k) contributions over the IRS limit",
      action: `401(k) contribution: ${over}`,
      href: "/paycheck",
      snoozeOnly: true,
    });
  });

  it("a 401(k) and a 403(b) share one limit: one item", () => {
    const recs = recommendationsFromCaps(
      [
        {
          personId: 7,
          personName: "Avery",
          accountTypes: [
            t("401(k)", "401k", 500, [over]),
            t("403(b)", "403b", 500, [over]),
          ],
        },
      ],
      2030,
    );
    expect(recs).toHaveLength(1);
    expect(recs[0]!.title).toBe(
      "Avery: 401(k) + 403(b) contributions over the IRS limit",
    );
  });

  it("a missing owner comes soon and can be dismissed; joint accounts have no person", () => {
    const [r] = recommendationsFromCaps(
      [
        {
          personId: null,
          personName: null,
          accountTypes: [t("IRA", "ira", 0, [owner])],
        },
      ],
      2030,
    );
    expect(r).toMatchObject({ id: "irsCap:joint:ira:2030", urgency: "soon" });
    expect(r!.snoozeOnly).toBeUndefined();
  });

  it("ranks ahead of soon items", () => {
    const recs = recommendationsFromCaps(
      [
        {
          personId: null,
          personName: null,
          accountTypes: [t("HSA", "hsa", 0, [owner])],
        },
        {
          personId: 7,
          personName: "Avery",
          accountTypes: [t("401(k)", "401k", 1, [over])],
        },
      ],
      2030,
    );
    expect(rankRecommendations(recs)[0]!.urgency).toBe("now");
  });

  it("a for-good dismissal never hides an over-limit item; a snooze does, until it ends", () => {
    const [r] = recommendationsFromCaps(
      [
        {
          personId: 7,
          personName: "Avery",
          accountTypes: [t("401(k)", "401k", 1, [over])],
        },
      ],
      2030,
    );
    const base = { urgency: "now" as const, on: "2030-03-01", note: "" };
    expect(
      applyDismissals([r!], { [r!.id]: { ...base, until: null } }, "2030-03-02")
        .shown,
    ).toHaveLength(1);
    expect(
      applyDismissals(
        [r!],
        { [r!.id]: { ...base, until: "2030-06-01" } },
        "2030-03-02",
      ).dismissed,
    ).toHaveLength(1);
  });
});
