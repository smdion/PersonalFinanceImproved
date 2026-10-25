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

vi.mock("@/lib/hooks/use-effective-salary-profile-id", () => ({
  useEffectiveSalaryProfileId: () => ({ queryInput: {} }),
}));
vi.mock("@/lib/hooks/use-effective-contrib-profile-id", () => ({
  useEffectiveContribProfileId: () => ({ queryInput: {} }),
}));
vi.mock("@/lib/context/user-context", () => ({
  useUser: () => ({ role: "viewer", name: "Test", permissions: [] }),
  isAdmin: (u: { role: string }) => u.role === "admin",
  hasPermission: () => true,
}));
vi.mock("@/lib/hooks/use-plan-engine-input", () => ({
  usePlanEngineInput: () => ({
    input: { decumulationDefaults: { withdrawalTaxPreference: {} } },
    ready: true,
    ids: {
      contributionProfileId: null,
      salaryProfileId: null,
      retirementProfileId: null,
      snapshotId: null,
    },
  }),
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
      {
        age: 40,
        year: 2026,
        retirementBalance: 500000,
        allAccountsBalance: 500000,
        individualAccountBalances: [],
      },
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
  irsGroupLimits: {},
  realDefaults: { annualByCategory: {}, employerMatchByCategory: {} },
  portfolioByTaxTypeByParentCat: {},
  decumulationExpenses: 40000,
  returnRateSummary: { avgAccumulation: 0.07 },
};

vi.mock("@/lib/hooks/use-year-end-targeting", () => ({
  useYearEndTargetingInput: () => ({}),
}));

let milestoneInputs: unknown = undefined;
let mcPeekData: unknown = { result: null };
let coastFireMcPeekData: unknown = { result: null };

vi.mock("@/lib/trpc", () => ({
  trpc: {
    milestones: {
      computeInputs: { useQuery: () => ({ data: milestoneInputs }) },
    },
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

describe("RetirementCard nest egg: simulated or baseline", () => {
  it("shows the Retirement page's simulated median and range, baseline alongside", () => {
    // Inflation 0 so today's $ = nominal: the figures read straight.
    engineData.settings.annualInflation = "0";
    mcPeekData = {
      result: {
        successRate: 0.9,
        percentileBands: [
          { age: 65, year: 2051, p25: 400000, p50: 620000, p75: 900000 },
        ],
      },
      simulationInputs: { computedAt: new Date().toISOString() },
    };
    coastFireMcPeekData = { result: null };
    render(<RetirementCard />);
    expect(screen.getByText("$620,000.00")).toBeInTheDocument();
    expect(screen.getByText(/simulated median/)).toBeInTheDocument();
    expect(screen.getByText(/Range \$400,000\.00/)).toBeInTheDocument();
    expect(screen.getByText(/\(fixed returns\)/)).toBeInTheDocument();
    engineData.settings.annualInflation = "0.03";
  });

  it("without a simulation: the labelled baseline and a pointer to run one", () => {
    mcPeekData = { result: null };
    coastFireMcPeekData = { result: null };
    render(<RetirementCard />);
    expect(screen.getByText(/baseline — fixed returns/)).toBeInTheDocument();
    const prompt = screen.getByText(/Run a simulation on the Retirement page/);
    // Plain text: the card itself is the link, and <a> can't nest.
    expect(prompt.closest("a")?.getAttribute("href")).toBe("/retirement");
    expect(prompt.querySelector("a")).toBeNull();
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
        // As the engine reports it: the Portfolio brokerage isn't retirement money.
        retirementBalance: 300000,
        allAccountsBalance: 400000,
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
    // Contributions: the 401k and its match, not the Portfolio brokerage
    // ($12,000). The mocked settings make this a high-income household, so
    // the shared match switch leaves the match out of the headline.
    expect(screen.getAllByText(/\$20,000\.00\s*\/yr/).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText("(+ $5,000.00 match)")).toBeInTheDocument();
    engineData.result.projectionByYear = saved;
    (engineData as Record<string, unknown>).contributionSpecs = savedSpecs;
  });
});

describe("RetirementCard readiness follows the household's checkpoint table", () => {
  const now = {
    year: 2026,
    isCurrent: true,
    age: 40,
    netWorth: 900000,
    liquid: 600000,
    cash: 20000,
    retirement: 450000,
    brokerage: 130000,
    grossIncome: 200000,
    contributions: null,
    wealthScore: 1.5,
    fiProgress: 0.3,
    mortgageBalance: 0,
    otherLiabilities: 0,
  };

  it("uses Money Guy's liquid investments by default", () => {
    mcPeekData = { result: null };
    coastFireMcPeekData = { result: null };
    milestoneInputs = { checkpointSource: "moneyGuy", years: [now] };
    render(<RetirementCard />);
    // 600k / 200k = 3.0×
    expect(screen.getByText("3.0x")).toBeInTheDocument();
    expect(screen.getByText(/pay · Money Guy/)).toBeInTheDocument();
  });

  it("uses Fidelity's retirement savings when chosen", () => {
    milestoneInputs = { checkpointSource: "fidelity", years: [now] };
    render(<RetirementCard />);
    // 450k / 200k = 2.25×
    expect(screen.getByText("2.3x")).toBeInTheDocument();
    expect(screen.getByText(/pay · Fidelity/)).toBeInTheDocument();
  });
});
