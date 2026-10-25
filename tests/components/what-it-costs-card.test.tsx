import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WhatItCostsCard } from "@/components/investments/what-it-costs-card";

vi.mock("@/components/ui/help-tip", () => ({ HelpTip: () => null }));

describe("WhatItCostsCard", () => {
  it("shows fund costs and account fees as two kinds, and a year of both", () => {
    render(
      <WhatItCostsCard
        cost={{ expenseRatio: 0.00068, yearlyCost: 545, coveredShare: 1 }}
        accountFees={{ year: 2031, thisYear: 134, lastYear: 168 }}
        invested={800000}
      />,
    );
    expect(screen.getByText("Fund costs")).toBeTruthy();
    expect(screen.getByText(/about \$545 a year/)).toBeTruthy();
    expect(screen.getByText(/inside the funds' prices/)).toBeTruthy();
    expect(screen.getByText("Account fees")).toBeTruthy();
    expect(screen.getByText("2030: $168 · 2031 so far: $134")).toBeTruthy();
    expect(screen.getByText("about $713 a year")).toBeTruthy();
    expect(screen.getByText(/2030's account fees/)).toBeTruthy();
  });

  it("no expense ratios yet: says so, and the total is account fees alone", () => {
    render(
      <WhatItCostsCard
        cost={{ expenseRatio: null, yearlyCost: 0, coveredShare: 0 }}
        accountFees={{ year: 2031, thisYear: 40, lastYear: null }}
        invested={0}
      />,
    );
    expect(screen.getByText("not known yet")).toBeTruthy();
    expect(screen.getByText("about $40 a year")).toBeTruthy();
    expect(screen.getByText(/2031's account fees/)).toBeTruthy();
  });
});
