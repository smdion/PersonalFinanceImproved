import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { resetTrpcMock, setQuery, type MockOutput } from "../trpc-mock";

// Direct smoke test for src/components/dashboard/retirement-card.tsx.
// tests/components/dashboard/dashboard.test.tsx mocks out all dashboard cards at the
// page level, so individual cards (including this one) have zero direct
// coverage. Follows the leaf-component tRPC-mock pattern from
// tests/components/dashboard/dashboard-net-worth-card.test.tsx. Focused on the new
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
    input: {
      selection: {},
      decumulationDefaults: { withdrawalTaxPreference: {} },
    },
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
  contributionSpecs: [],
  people: [],
  primaryPersonId: null,
  returnRateSummary: { avgAccumulation: 0.07 },
};

vi.mock("@/lib/hooks/use-year-end-targeting", () => ({
  useYearEndTargetingInput: () => ({}),
}));

const milestoneInputsAre = (
  data: MockOutput<"milestones.computeInputs"> | undefined,
) => setQuery("milestones.computeInputs", data);
const mcPeekIs = (data: MockOutput<"projection.peekMonteCarloSummary">) =>
  setQuery("projection.peekMonteCarloSummary", data);
const coastFireMcPeekIs = (data: MockOutput<"projection.computeCoastFireMC">) =>
  setQuery("projection.computeCoastFireMC", data);

// A line of 0 puts every household over it, so the match is left out of the
// totals by default — what the scope test below reads.
vi.mock("@/lib/hooks/use-high-income-line", () => ({
  useHighIncomeLine: () => ({
    threshold: 0,
    basis: null,
    defaultThreshold: 200_000,
    setSaved: vi.fn(),
  }),
}));

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("../trpc-mock")).trpc,
}));

import { RetirementCard } from "@/components/dashboard/retirement-card";

beforeEach(() => {
  resetTrpcMock();
  milestoneInputsAre(undefined);
  mcPeekIs({ result: null });
  coastFireMcPeekIs({ result: null });
  // A partial engine answer: only what the card reads.
  setQuery(
    "projection.computeProjection",
    engineData as MockOutput<"projection.computeProjection">,
  );
  setQuery("projection.computeCoastFire", {
    result: { status: "found", coastFireAge: 50 },
  });
});

describe("RetirementCard dashboard cache-peek features", () => {
  it("shows nothing extra when neither peek query has cached data", () => {
    mcPeekIs({ result: null });
    coastFireMcPeekIs({ result: null });
    render(<RetirementCard />);
    expect(screen.queryByText("Simulated success")).toBeNull();
    expect(
      screen.getByText(/baseline; see Plan Health for simulated/),
    ).toBeInTheDocument();
  });

  it("shows the MC confidence badge with a relative freshness label on a peek hit", () => {
    mcPeekIs({
      result: { successRate: 0.92, todayBands: [] },
      computedAt: new Date().toISOString(),
    });
    coastFireMcPeekIs({ result: null });
    render(<RetirementCard />);
    expect(screen.getByText("Simulated success")).toBeInTheDocument();
    expect(screen.getByText("92%")).toBeInTheDocument();
    // The figure links to where it's explained (Plan Health).
    expect(screen.getByText("92%").closest("a")?.getAttribute("href")).toBe(
      "/retirement?focus=planHealth",
    );
    expect(screen.getByText("Last simulation run")).toBeInTheDocument();
    expect(screen.getByText("just now")).toBeInTheDocument();
  });

  it("shows the simulated Coast FIRE age next to the deterministic baseline", () => {
    mcPeekIs({ result: null });
    coastFireMcPeekIs({
      result: { status: "found", coastFireAge: 55 },
    });
    render(<RetirementCard />);
    expect(screen.getByText("(simulated: 2041)")).toBeInTheDocument();
  });
});

describe("RetirementCard nest egg: simulated or baseline", () => {
  it("shows the Retirement page's simulated median and range, baseline alongside", () => {
    // Inflation 0 so today's $ = nominal for the baseline; the card reads
    // the simulation's own today's-dollar bands (deflated per trial; the
    // summary picks them: tests/routers/projection-coverage.test.ts).
    engineData.settings.annualInflation = "0";
    mcPeekIs({
      result: {
        successRate: 0.9,
        todayBands: [
          { age: 65, year: 2051, p25: 400000, p50: 620000, p75: 900000 },
        ],
      },
      computedAt: new Date().toISOString(),
    });
    coastFireMcPeekIs({ result: null });
    render(<RetirementCard />);
    expect(screen.getByText("$620,000.00")).toBeInTheDocument();
    expect(screen.getByText(/simulated median/)).toBeInTheDocument();
    expect(screen.getByText(/Range \$400,000\.00/)).toBeInTheDocument();
    expect(screen.getByText(/\(fixed returns\)/)).toBeInTheDocument();
    engineData.settings.annualInflation = "0.03";
  });

  it("without a simulation: the labelled baseline and a pointer to run one", () => {
    mcPeekIs({ result: null });
    coastFireMcPeekIs({ result: null });
    render(<RetirementCard />);
    expect(screen.getByText(/baseline — fixed returns/)).toBeInTheDocument();
    const prompt = screen.getByText(/Run a simulation on the Retirement page/);
    // Plain text: the card's title is its link, and a click on the card
    // surface follows it.
    expect(prompt.closest("a")).toBeNull();
    expect(
      screen.getByRole("link", { name: "Retirement" }).getAttribute("href"),
    ).toBe("/retirement");
  });
});

describe("RetirementCard scope", () => {
  it("counts Retirement accounts only, like the Retirement page", () => {
    mcPeekIs({ result: null });
    coastFireMcPeekIs({ result: null });
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
    mcPeekIs({ result: null });
    coastFireMcPeekIs({ result: null });
    milestoneInputsAre({ checkpointSource: "moneyGuy", years: [now] });
    render(<RetirementCard />);
    // 600k / 200k = 3.0×
    expect(screen.getByText("3.0x")).toBeInTheDocument();
    expect(screen.getByText(/pay · Money Guy/)).toBeInTheDocument();
  });

  it("uses Fidelity's retirement savings when chosen", () => {
    milestoneInputsAre({ checkpointSource: "fidelity", years: [now] });
    render(<RetirementCard />);
    // 450k / 200k = 2.25×
    expect(screen.getByText("2.3x")).toBeInTheDocument();
    expect(screen.getByText(/pay · Fidelity/)).toBeInTheDocument();
  });
});
