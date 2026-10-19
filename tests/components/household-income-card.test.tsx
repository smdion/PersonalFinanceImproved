/**
 * Household Income card + its taxes line read household annual income:
 * the resolved bonus everywhere (the set bonus when there is one), the
 * formula shown beside it when they differ, and the household tax in the
 * projected and year-end views. Mocked at the trpc + primitive-hook layer,
 * like dashboard-living-costs-card.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

let viewMode = "projected";
vi.mock("@/lib/context/scenario-context", () => ({
  useScenario: () => ({ activeScenario: null, viewMode }),
}));
vi.mock("@/lib/hooks/use-salary-overrides", () => ({
  useActiveSalaries: () => [],
}));
vi.mock("@/lib/hooks/use-persisted-setting", () => ({
  usePersistedSetting: (_key: string, defaultValue: unknown) => [
    defaultValue,
    vi.fn(),
  ],
}));
vi.mock("@/components/ui/help-tip", () => ({ HelpTip: () => null }));

// One person, monthly pay. Salary $60,000; a SET bonus of $6,000 while the
// formula would give $9,000.
const bonusEstimate = (gross: number, net: number) => ({
  bonusGross: gross,
  bonusNet: net,
  bonusFederalWithholding: 0,
  bonusFica: 0,
  bonusContributions: 0,
  bonusFicaWages: gross,
});
const summary = {
  people: [
    {
      person: { id: 1, name: "Pat" },
      job: { bonusMonth: null, bonusDayOfMonth: null },
      salary: 60000,
      paycheck: {
        gross: 5000,
        netPay: 3800,
        periodsPerYear: 12,
        periodsElapsedYtd: 3,
        bonusEstimate: bonusEstimate(6000, 4300),
        federalWithholding: 600,
        ficaSS: 310,
        ficaMedicare: 72.5,
      },
      fullFormulaBonusEstimate: bonusEstimate(9000, 6450),
      resolvedBonusTerms: { bonusOverride: 6000 },
      blendedAnnual: { gross: 60000, netPay: 45600 },
    },
  ],
  householdIncome: {
    salary: 60000,
    bonus: 6000,
    gross: 66000,
    preTaxFederal: 3000,
    ficaWages: 66000,
    netRegular: 45600,
    netBonus: 4300,
  },
  householdTax: {
    wageAgi: 63000,
    federalTax: 4000,
    ficaSS: 4092,
    ficaMedicare: 957,
    effectiveRate: 4000 / 63000,
    marginalRate: 0.12,
    totalTax: 9049,
    warnings: ["Additional Medicare Tax: example note"],
  },
};

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      settings: { appSettings: { list: { invalidate: vi.fn() } } },
    }),
    settings: { appSettings: { list: { useQuery: () => ({ data: [] }) } } },
    salaryProfile: {
      list: { useQuery: () => ({ data: [] }) },
      setActive: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
    contributionProfile: {
      list: { useQuery: () => ({ data: [] }) },
      setActive: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
    paycheck: {
      computeSummary: {
        useQuery: () => ({ isLoading: false, error: null, data: summary }),
      },
    },
  },
}));

import { HouseholdIncomeCard } from "@/components/cards/dashboard/household-income-card";

describe("HouseholdIncomeCard", () => {
  beforeEach(() => {
    viewMode = "projected";
  });

  it("projected: headline is household annual income with the SET bonus, formula shown beside it", () => {
    render(<HouseholdIncomeCard />);
    expect(screen.getByText("$66,000.00")).toBeInTheDocument();
    expect(screen.getByText(/\$6,000\.00 gross/)).toBeInTheDocument();
    expect(screen.getByText(/Formula target \$9,000\.00/)).toBeInTheDocument();
    // Net = regular + bonus take-home.
    expect(screen.getByText("$49,900.00")).toBeInTheDocument();
  });

  it("projected and year-end taxes are the household tax, with its notes", () => {
    for (const mode of ["projected", "blended"]) {
      viewMode = mode;
      const { unmount } = render(<HouseholdIncomeCard />);
      expect(screen.getByText("$9,049.00")).toBeInTheDocument();
      expect(
        screen.getByText("Additional Medicare Tax: example note"),
      ).toBeInTheDocument();
      unmount();
    }
  });

  it("YTD taxes are withholding so far, without the annual notes", () => {
    viewMode = "ytd";
    render(<HouseholdIncomeCard />);
    // (600 + 310 + 72.5) × 3 checks
    expect(screen.getByText("$2,947.50")).toBeInTheDocument();
    expect(
      screen.queryByText("Additional Medicare Tax: example note"),
    ).not.toBeInTheDocument();
  });
});
