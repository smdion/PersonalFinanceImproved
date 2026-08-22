import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";

// Direct math-verification test for
// src/components/cards/dashboard/living-costs-card.tsx — until now this card
// had zero direct coverage (only tests/config/living-costs.test.ts, which
// just checks the Ramsey range/mapping config, not the card's percentage
// arithmetic). Every dollar figure below is hand-picked so the expected
// percentages can be computed by hand and cross-checked against what
// actually renders, in both the Net and Gross toggle states.
//
// Mocked at the trpc + primitive-hook layer (usePersistedSetting,
// useActiveSalaries, useScenario) rather than mocking the card's own
// higher-level hooks (useEffectiveSalaryProfileId, useBudgetProfilesList,
// etc.) — those are thin, real, pure derivations over the same primitives,
// so letting them run for real is both less brittle and exercises the actual
// resolution chain the app uses.

vi.mock("@/lib/context/scenario-context", () => ({
  useScenario: () => ({ activeScenario: null }),
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
// HelpTip needs a Radix TooltipProvider ancestor this card doesn't supply on
// its own (normally comes from a layout higher up) — same pattern as
// coast-fire-card.test.tsx.
vi.mock("@/components/ui/help-tip", () => ({ HelpTip: () => null }));

const budgetQuery = {
  isLoading: false,
  data: {
    result: {
      categories: [
        { name: "Housing", total: 1000 },
        { name: "Food", total: 400 },
      ],
    },
    columnMonths: null,
    allColumnResults: null,
    rawItems: [],
  },
};

// One person, monthly pay (periodsPerYear: 12) for simple arithmetic.
// netPay 4000/mo -> netIncome 48000/yr. salary (gross) 60000/yr.
// One raw paycheck deduction (health insurance) at $100/period -> $1200/yr,
// only ever subtracted in Gross mode (Net mode's netPay already nets it out).
const paycheckQuery = {
  isLoading: false,
  data: {
    people: [
      {
        salary: 60000,
        paycheck: { netPay: 4000, periodsPerYear: 12 },
        rawDeductions: [{ amountPerPeriod: "100" }],
      },
    ],
    householdTax: { totalTax: 12000 },
  },
};

// Retirement: one IRA (non-payroll, $2000/yr) + one 401k (payroll-deducted,
// $5000/yr). Net mode should only ever see the IRA's $2000 (money that came
// out of take-home pay); Gross mode sees the full $7000.
const contribQuery = {
  isLoading: false,
  data: {
    people: [
      {
        accountTypes: [
          { parentCategory: "Retirement", nonPayrollContrib: 2000 },
          { parentCategory: "Retirement", nonPayrollContrib: 0 },
        ],
        totals: {
          views: {
            projected: {
              retirementWithoutMatch: 7000,
              portfolioWithoutMatch: 0,
            },
          },
        },
      },
    ],
    jointAccountTypes: [],
  },
};

const savingsQuery = {
  isLoading: false,
  data: { savings: { goals: [{ monthlyAllocation: 200 }] } },
};

const extraPaycheckQuery = { isLoading: false, data: [] };

vi.mock("@/lib/trpc", () => ({
  trpc: {
    settings: { appSettings: { list: { useQuery: () => ({ data: [] }) } } },
    salaryProfile: { list: { useQuery: () => ({ data: [] }) } },
    contributionProfile: { list: { useQuery: () => ({ data: [] }) } },
    budget: {
      computeActiveSummary: { useQuery: () => budgetQuery },
      listProfiles: { useQuery: () => ({ data: [] }) },
    },
    paycheck: { computeSummary: { useQuery: () => paycheckQuery } },
    contribution: { computeSummary: { useQuery: () => contribQuery } },
    savings: {
      computeSummary: { useQuery: () => savingsQuery },
      extraPaycheckRouting: { list: { useQuery: () => extraPaycheckQuery } },
    },
  },
}));

import { LivingCostsCard } from "@/components/cards/dashboard/living-costs-card";

describe("LivingCostsCard math", () => {
  it("Net mode: Housing/Food at Ramsey's low edge, Retirement/Savings/Unallocated correct", () => {
    render(<LivingCostsCard />);

    // Housing: $12,000/yr / $48,000 net = 25.00% — exactly Ramsey's low edge,
    // so "on-target" (25%/25%-35%).
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(screen.getByText("/ 25%-35%")).toBeInTheDocument();
    // Food: $4,800/yr / $48,000 = 10.00% — exactly Ramsey's low edge.
    expect(screen.getByText("10%")).toBeInTheDocument();
    expect(screen.getByText("/ 10%-15%")).toBeInTheDocument();
    // Both land in-range (not below), so 2/2.
    expect(screen.getByText(/2\/2 within range/)).toBeInTheDocument();

    // Retirement (Net): only the $2,000 non-payroll IRA counts, not the
    // $5,000 payroll-deducted 401k -> 2000/48000 = 4.17% -> rounds to 4%.
    expect(screen.getByText("Retirement")).toBeInTheDocument();
    expect(screen.getByText("4%")).toBeInTheDocument();
    expect(screen.getByText("($2,000.00)")).toBeInTheDocument();

    // Savings: 2400/48000 = 5%.
    expect(screen.getByText("5%")).toBeInTheDocument();
    expect(screen.getByText("($2,400.00)")).toBeInTheDocument();

    // Unallocated: 48000 - 2000(retirement) - 2400(savings) - 16800(budget)
    // = 26,800 -> 26800/48000 = 55.83% -> rounds to 56%.
    expect(screen.getByText("56%")).toBeInTheDocument();
    expect(screen.getByText("($26,800.00)")).toBeInTheDocument();

    // No Taxes or Other Paycheck Deductions row in Net mode.
    expect(screen.queryByText("Taxes")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Other Paycheck Deductions"),
    ).not.toBeInTheDocument();

    // Sanity-check total: every row's exact fraction (not the rounded
    // per-row display) sums to precisely 100% of net.
    expect(screen.getByText("Total: 100% of net")).toBeInTheDocument();
  });

  it("Gross mode: Taxes/Other Paycheck Deductions appear, Retirement counts the full payroll amount", () => {
    render(<LivingCostsCard />);
    fireEvent.click(screen.getByText(/Gross \(/));

    // Housing: 12000/60000 = 20% — below Ramsey's 25% floor. Taxes (below)
    // is also exactly 20%, so two "20%" labels are expected here.
    expect(screen.getAllByText("20%")).toHaveLength(2);
    // Food: 4800/60000 = 8% — below Ramsey's 10% floor.
    expect(screen.getByText("8%")).toBeInTheDocument();
    // Both below range still count as "within range" (this card only flags
    // "above" a Ramsey ceiling as a problem), so 2/2.
    expect(screen.getByText(/2\/2 within range/)).toBeInTheDocument();

    // Taxes: 12000/60000 = 20%.
    expect(screen.getByText("Taxes")).toBeInTheDocument();
    expect(screen.getByText("($12,000.00)")).toBeInTheDocument();

    // Other Paycheck Deductions: 1200/60000 = 2% — the row this session's
    // fix added; would have been silently missing before.
    expect(screen.getByText("Other Paycheck Deductions")).toBeInTheDocument();
    expect(screen.getByText("($1,200.00)")).toBeInTheDocument();

    // Retirement (Gross): full $7,000 (IRA + 401k) -> 7000/60000 = 11.67%
    // -> rounds to 12%.
    expect(screen.getByText("12%")).toBeInTheDocument();
    expect(screen.getByText("($7,000.00)")).toBeInTheDocument();

    // Unallocated: 60000 - 12000(tax) - 1200(otherDed) - 7000(retirement)
    // - 2400(savings) - 16800(budget) = 20,600 -> 20600/60000 = 34.33%
    // -> rounds to 34%.
    expect(screen.getByText("34%")).toBeInTheDocument();
    expect(screen.getByText("($20,600.00)")).toBeInTheDocument();

    // Gross and Net waterfalls reconcile to the same total once Taxes and
    // Other Paycheck Deductions are both accounted for.
    expect(screen.getByText("Total: 100% of gross")).toBeInTheDocument();
  });
});
