import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RetirementBridge } from "@/components/cards/dashboard/retirement-bridge";

// The help tip carries the bridge's detail — render its lines to check them.
vi.mock("@/components/ui/help-tip", () => ({
  HelpTip: ({ lines }: { lines?: string[] }) => (
    <span data-testid="tip">{lines?.join(" | ")}</span>
  ),
}));

const year = (
  y: number,
  accounts: unknown[],
  o: Record<string, unknown> = {},
) => ({
  year: y,
  age: y - 1989,
  phase: "decumulation",
  afterTaxNeed: 60_000,
  ssIncome: 0,
  deliveredAfterTax: 60_000,
  unmetNeedMaterial: false,
  penaltyAvoidedShortfall: 0,
  nonRetirementShortfall: 0,
  penaltyCost: 0,
  projectedExpenses: 60_000,
  budgetOnlyExpenses: 60_000,
  rothConversionAmount: 0,
  penaltyLockedStillExcluded: 1,
  individualAccountBalances: accounts,
  ...o,
});
const brokerage = {
  name: "Taxable",
  category: "brokerage",
  taxType: "afterTax",
  parentCategory: "Retirement",
  balance: 300_000,
  penaltyFreeAmount: 300_000,
  penaltyExposedAmount: 0,
  withdrawal: 60_000,
};
const locked = {
  name: "IRA",
  category: "ira",
  taxType: "preTax",
  ownerName: "Pat",
  ownerPersonId: 1,
  parentCategory: "Retirement",
  balance: 500_000,
  penaltyFreeAmount: 0,
  penaltyExposedAmount: 500_000,
};

describe("RetirementBridge", () => {
  it("covered: the years, the verdict, where the money is and when locked money opens", () => {
    render(
      <RetirementBridge
        projection={
          [
            year(2044, [brokerage, locked]),
            year(2045, [brokerage, locked]),
            year(2046, [brokerage], { penaltyLockedStillExcluded: 0 }),
          ] as never
        }
      />,
    );
    // The verdict links to where it's shown in detail.
    expect(
      screen.getByRole("link", { name: "Covered" }).getAttribute("href"),
    ).toBe("/tax-buckets?focus=earlyAccess");
    expect(
      screen.getByText("2044–2045 · until locked accounts open"),
    ).toBeTruthy();
    expect(screen.getByText("Tightest: 2044, $240k to spare")).toBeTruthy();
    const tip = screen.getByTestId("tip").textContent;
    expect(tip).toMatch(/Reachable in 2044: Brokerage \$300k/);
    expect(tip).toMatch(/Opens: Pat 2046/);
  });

  it("short because money is locked: says so and what helps", () => {
    render(
      <RetirementBridge
        projection={
          [
            year(2044, [locked], {
              unmetNeedMaterial: true,
              penaltyAvoidedShortfall: 60_000,
              deliveredAfterTax: 0,
            }),
          ] as never
        }
      />,
    );
    expect(
      screen.getByRole("link", { name: "Short" }).getAttribute("href"),
    ).toBe("/retirement?focus=projectionYear&focusId=2044");
    expect(screen.getByText("1 of 1 yr · 2044")).toBeTruthy();
    expect(screen.getByText(/^Money is locked: retire later/)).toBeTruthy();
  });

  it("nothing to show without the engine's eligibility figures", () => {
    const { container } = render(
      <RetirementBridge
        projection={
          [year(2044, [], { penaltyLockedStillExcluded: undefined })] as never
        }
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
