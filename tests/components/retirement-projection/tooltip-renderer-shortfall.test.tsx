import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderTooltip } from "@/components/retirement-projection/tooltip-renderer";
import { UNMET_PART_LABEL } from "@/lib/config/display-labels";
import { formatCurrency } from "@/lib/utils/format";

describe("the unmet need's parts in a tooltip", () => {
  it("each reads as what its money could cover, unsigned, beside the whole", () => {
    // Both parts can each be the whole unmet need: they overlap, never add.
    render(
      <>
        {renderTooltip({
          kind: "money",
          header: "Total Withdrawals",
          shortfall: {
            amount: 24055.56,
            penaltyAvoidedAmount: 24055.56,
            nonRetirementAmount: 24055.56,
          },
        })}
      </>,
    );
    expect(screen.getByText(UNMET_PART_LABEL.penaltyAvoided)).toBeTruthy();
    expect(screen.getByText(UNMET_PART_LABEL.nonRetirement)).toBeTruthy();
    expect(screen.getByText(`-${formatCurrency(24055.56)}`)).toBeTruthy();
    expect(screen.getAllByText(formatCurrency(24055.56))).toHaveLength(2);
  });
});
