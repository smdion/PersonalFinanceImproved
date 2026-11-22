/* eslint-disable no-restricted-syntax -- as unknown as builds a year row from only the facts the notice reads */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { EngineYearProjection } from "@/lib/pure/engine/types";
import {
  unmetNeedNotice,
  yearNotices,
} from "@/components/retirement-projection/table/year-notices.model";
import { YearNoticesBadge } from "@/components/retirement-projection/table/year-notices-badge";
import { renderTooltip } from "@/components/retirement-projection/tooltip-renderer";

const asIs = (amount: number) => amount;

function retirementYear(facts: {
  unmetNeed?: number;
  unmetNeedMaterial?: boolean;
  penaltyAvoidedShortfall?: number;
  nonRetirementShortfall?: number;
  retirementBalance?: number;
  warnings?: string[];
}): EngineYearProjection {
  return {
    year: 2027,
    phase: "decumulation",
    shortfallMaterialityFloor: 412,
    retirementBalance: 2_200_000,
    warnings: [],
    ...facts,
  } as unknown as EngineYearProjection;
}

function gapYear(gapDraw: { need: number; unmetNeed: number }) {
  return {
    year: 2031,
    phase: "accumulation",
    gapDraw,
    warnings: ["Traditional withdrawal cap hit"],
  } as unknown as EngineYearProjection;
}

describe("a year's unmet need in the table row's notices", () => {
  it("states the unmet need alone when no part explains it and money remains", () => {
    expect(
      unmetNeedNotice(
        retirementYear({ unmetNeed: 41200, unmetNeedMaterial: true }),
        asIs,
      ),
    ).toBe("$41,200.00 of this year's spending can't be funded.");
  });

  it("states what penalty-locked money could cover, of it", () => {
    expect(
      unmetNeedNotice(
        retirementYear({
          unmetNeed: 24055.56,
          unmetNeedMaterial: true,
          penaltyAvoidedShortfall: 24055.56,
        }),
        asIs,
      ),
    ).toBe(
      "$24,055.56 of this year's spending can't be funded. Penalty-locked money could cover $24,055.56 of it.",
    );
  });

  it("states what Portfolio money could cover, of it", () => {
    expect(
      unmetNeedNotice(
        retirementYear({
          unmetNeed: 30000,
          unmetNeedMaterial: true,
          nonRetirementShortfall: 12000,
        }),
        asIs,
      ),
    ).toBe(
      "$30,000.00 of this year's spending can't be funded. Portfolio money could cover $12,000.00 of it.",
    );
  });

  it("states both parts, locked first, each of the whole, never added", () => {
    expect(
      unmetNeedNotice(
        retirementYear({
          unmetNeed: 5000,
          unmetNeedMaterial: true,
          penaltyAvoidedShortfall: 5000,
          nonRetirementShortfall: 5000,
        }),
        asIs,
      ),
    ).toBe(
      "$5,000.00 of this year's spending can't be funded. Penalty-locked money could cover $5,000.00 of it. Portfolio money could cover $5,000.00 of it.",
    );
  });

  it("says retirement money has run out when the plan judge would call it gone", () => {
    expect(
      unmetNeedNotice(
        retirementYear({
          unmetNeed: 98000,
          unmetNeedMaterial: true,
          retirementBalance: 0,
        }),
        asIs,
      ),
    ).toBe(
      "$98,000.00 of this year's spending can't be funded: retirement money has run out.",
    );
  });

  it("says nothing for an unmet need under the materiality floor", () => {
    expect(
      unmetNeedNotice(
        retirementYear({ unmetNeed: 0.18, unmetNeedMaterial: false }),
        asIs,
      ),
    ).toBeUndefined();
  });

  it("states a gap year's unmet need, with no cause", () => {
    expect(
      unmetNeedNotice(gapYear({ need: 60000, unmetNeed: 20000 }), asIs),
    ).toBe(
      "$20,000.00 of this year's spending can't be funded with a paycheck gone.",
    );
    expect(
      unmetNeedNotice(gapYear({ need: 60000, unmetNeed: 30 }), asIs),
    ).toBeUndefined();
  });

  it("deflates the amount as the tooltip does", () => {
    expect(
      unmetNeedNotice(
        retirementYear({ unmetNeed: 41200, unmetNeedMaterial: true }),
        (amount) => amount / 2,
      ),
    ).toBe("$20,600.00 of this year's spending can't be funded.");
  });

  it("puts the unmet need first, then the engine's warnings, in the row's badge", () => {
    const notices = yearNotices(
      gapYear({ need: 60000, unmetNeed: 20000 }),
      asIs,
    );
    expect(notices).toEqual([
      "$20,000.00 of this year's spending can't be funded with a paycheck gone.",
      "Traditional withdrawal cap hit",
    ]);
    render(
      <TooltipProvider>
        <YearNoticesBadge notices={notices} renderTooltip={renderTooltip} />
      </TooltipProvider>,
    );
    expect(screen.getByText(/2 warning/)).toBeTruthy();
  });

  it("shows no badge for a year with no notices", () => {
    const { container } = render(
      <TooltipProvider>
        <YearNoticesBadge
          notices={yearNotices(retirementYear({}), asIs)}
          renderTooltip={renderTooltip}
        />
      </TooltipProvider>,
    );
    expect(container.textContent).toBe("");
  });
});
