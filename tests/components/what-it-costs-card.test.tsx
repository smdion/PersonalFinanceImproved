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
        expectedReturn={null}
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
        expectedReturn={0.06}
      />,
    );
    expect(screen.getByText("not known yet")).toBeTruthy();
    expect(screen.getByText("about $40 a year")).toBeTruthy();
    expect(screen.getByText(/2031's account fees/)).toBeTruthy();
  });

  it("compounds fund costs over 10, 20 and 30 years at the mix's return", () => {
    render(
      <WhatItCostsCard
        cost={{ expenseRatio: 0.01, yearlyCost: 1000, coveredShare: 1 }}
        accountFees={{ year: 2031, thisYear: null, lastYear: null }}
        invested={100000}
        expectedReturn={0.06}
      />,
    );
    // $100,000 at 6% vs 5% for 10 years.
    expect(screen.getByText("Over 10 years")).toBeTruthy();
    expect(screen.getByText("$16,195")).toBeTruthy();
    expect(screen.getByText("Over 30 years")).toBeTruthy();
    expect(screen.getByText(/6\.0% a year/)).toBeTruthy();
  });

  it("no compounded cost without an expected return or expense ratio", () => {
    render(
      <WhatItCostsCard
        cost={{ expenseRatio: null, yearlyCost: 0, coveredShare: 0 }}
        accountFees={{ year: 2031, thisYear: 40, lastYear: null }}
        invested={0}
        expectedReturn={0.06}
      />,
    );
    expect(screen.queryByText(/Over 10 years/)).toBeNull();
  });
});
