import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Direct smoke test for src/components/cards/dashboard/retirement-card.tsx.
// tests/components/dashboard.test.tsx mocks out all dashboard cards at the
// page level, so individual cards (including this one) have zero direct
// coverage. Follows the leaf-component tRPC-mock pattern from
// tests/components/dashboard-net-worth-card.test.tsx. Focused on the new
// peek-only MC confidence badge / simulated Coast FIRE / freshness label —
// not a full re-test of every existing metric on this card.

vi.mock("@/components/ui/help-tip", () => ({
  HelpTip: () => null,
}));

vi.mock("@/lib/hooks/use-salary-overrides", () => ({
  useActiveSalaries: () => [],
}));
vi.mock("@/lib/hooks/use-effective-salary-profile-id", () => ({
  useEffectiveSalaryProfileId: () => ({ queryInput: {} }),
}));
vi.mock("@/lib/hooks/use-effective-contrib-profile-id", () => ({
  useEffectiveContribProfileId: () => ({ queryInput: {} }),
}));
vi.mock("@/lib/hooks/use-persisted-setting", () => ({
  usePersistedSetting: () => [null, vi.fn()],
}));
vi.mock("@/lib/context/scenario-context", () => ({
  useScenario: () => ({ isInScenario: false }),
}));

const engineData = {
  result: {
    projectionByYear: [
      { age: 40, endBalance: 500000, individualAccountBalances: [] },
    ] as unknown[],
    sustainableWithdrawal: 20000,
    warnings: [],
  },
  settings: {
    retirementAge: 65,
    endAge: 90,
    withdrawalRate: "0.04",
    annualInflation: "0.03",
    withdrawalStrategy: "fixed",
  },
  baseLimits: {},
  realDefaults: { annualByCategory: {}, employerMatchByCategory: {} },
  portfolioByTaxTypeByParentCat: {},
  decumulationExpenses: 40000,
  returnRateSummary: { avgAccumulation: 0.07 },
};

let mcPeekData: unknown = { result: null };
let coastFireMcPeekData: unknown = { result: null };

vi.mock("@/lib/trpc", () => ({
  trpc: {
    projection: {
      computeProjection: {
        useQuery: () => ({
          data: engineData,
          isLoading: false,
          isFetching: false,
          error: null,
        }),
      },
      computeCoastFire: {
        useQuery: () => ({
          data: { result: { status: "found", coastFireAge: 50 } },
        }),
      },
      computeMonteCarloProjection: {
        useQuery: () => ({ data: mcPeekData }),
      },
      computeCoastFireMC: {
        useQuery: () => ({ data: coastFireMcPeekData }),
      },
    },
  },
}));

import { RetirementCard } from "@/components/cards/dashboard/retirement-card";

describe("RetirementCard dashboard cache-peek features", () => {
  it("shows nothing extra when neither peek query has cached data", () => {
    mcPeekData = { result: null };
    coastFireMcPeekData = { result: null };
    render(<RetirementCard />);
    expect(screen.queryByText("Simulated success")).toBeNull();
    expect(
      screen.getByText(/baseline; see Plan Health for simulated/),
    ).toBeInTheDocument();
  });

  it("shows the MC confidence badge with a relative freshness label on a peek hit", () => {
    mcPeekData = {
      result: { successRate: 0.92 },
      simulationInputs: { computedAt: new Date().toISOString() },
    };
    coastFireMcPeekData = { result: null };
    render(<RetirementCard />);
    expect(screen.getByText("Simulated success")).toBeInTheDocument();
    expect(screen.getByText("92%")).toBeInTheDocument();
    expect(screen.getByText("Last simulation run")).toBeInTheDocument();
    expect(screen.getByText("just now")).toBeInTheDocument();
  });

  it("shows the simulated Coast FIRE age next to the deterministic baseline", () => {
    mcPeekData = { result: null };
    coastFireMcPeekData = {
      result: { status: "found", coastFireAge: 55 },
    };
    render(<RetirementCard />);
    expect(screen.getByText("(simulated: age 55)")).toBeInTheDocument();
  });
});

describe("RetirementCard scope", () => {
  it("counts Retirement accounts only, like the Retirement page", () => {
    mcPeekData = { result: null };
    coastFireMcPeekData = { result: null };
    const saved = engineData.result.projectionByYear;
    const savedSpecs = (engineData as Record<string, unknown>)
      .contributionSpecs;
    // At retirement age: $300k in a Retirement 401k, $100k in a Portfolio brokerage.
    engineData.result.projectionByYear = [
      {
        age: 65,
        phase: "accumulation",
        endBalance: 400000,
        individualAccountBalances: [
          {
            category: "401k",
            taxType: "preTax",
            parentCategory: "Retirement",
            balance: 300000,
          },
          {
            category: "brokerage",
            taxType: "afterTax",
            parentCategory: "Portfolio",
            balance: 100000,
          },
        ],
        balanceByTaxType: {
          preTax: 300000,
          taxFree: 0,
          hsa: 0,
          afterTax: 100000,
          afterTaxBasis: 50000,
        },
        balanceByAccount: {
          brokerage: {
            structure: "basis_tracking",
            balance: 100000,
            basis: 50000,
          },
        },
      },
    ];
    (engineData as Record<string, unknown>).contributionSpecs = [
      {
        category: "401k",
        parentCategory: "Retirement",
        baseAnnual: 20000,
        matchAnnual: 5000,
      },
      {
        category: "brokerage",
        parentCategory: "Portfolio",
        baseAnnual: 12000,
        matchAnnual: 0,
      },
    ];
    engineData.settings.retirementAge = 65;
    render(<RetirementCard />);
    // Nest egg: the Retirement 401k only (no inflation adjustment at age 65 = now).
    expect(screen.getByText("$300,000.00")).toBeInTheDocument();
    // Contributions: the 401k and its match, not the Portfolio brokerage.
    expect(screen.getByText(/\$25,000\.00\/yr/)).toBeInTheDocument();
    engineData.result.projectionByYear = saved;
    (engineData as Record<string, unknown>).contributionSpecs = savedSpecs;
  });
});
