/**
 * Tests for the extracted projection sub-components:
 * - overrides-panel (shell) → SavingOverridesSection, WithdrawalOverridesSection, LifeChangesSection
 * - ProjectionHeroKpis (deterministic + MC)
 * - ProjectionChart + ProjectionChartSkeleton
 * - McDepletionCallout + McResultsSection
 *
 * Strategy: mock useProjectionState return value and render each component with
 * representative state shapes. Verify correct text/elements appear.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Shared mocks — heavy dependencies that all sub-components import transitively
// ---------------------------------------------------------------------------

vi.mock("recharts", () => ({
  ComposedChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="composed-chart">{children}</div>
  ),
  Bar: () => <div data-testid="bar" />,
  Area: () => <div data-testid="area" />,
  Line: () => <div data-testid="line" />,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
}));

vi.mock("@/components/ui/help-tip", () => ({
  HelpTip: ({ text }: { text?: string }) => (
    <span data-testid="help-tip" title={text} />
  ),
}));

vi.mock("@/lib/utils/format", () => ({
  formatCurrency: (v: number) => `$${Math.round(v).toLocaleString()}`,
  formatPercent: (v: number, _d?: number) => `${(v * 100).toFixed(1)}%`,
}));

vi.mock("@/lib/utils/colors", () => ({
  taxTypeLabel: (k: string) => k,
  accountTextColor: () => "text-blue-500",
  categoryChartHex: () => "#aaa",
}));

const mockAccountConfig = {
  displayLabel: "Account",
  supportsRothSplit: true,
  balanceStructure: "roth_traditional",
  taxBucketKey: "preTax",
};

vi.mock("@/lib/config/account-types", () => ({
  getAccountTypeConfig: (cat: string) => ({
    ...mockAccountConfig,
    displayLabel: cat,
  }),
  categoriesWithTaxPreference: () => ["401k"],
  getLimitGroup: () => "401k",
  getAllCategories: () => ["401k", "ira", "hsa", "brokerage"],
  getAccountSegments: () => [
    {
      key: "401k_trad",
      category: "401k",
      subKey: "trad",
      label: "401k Trad",
    },
  ],
  getSegmentBalance: () => 100000,
  parseColumnKey: () => null,
  ACCOUNT_TYPE_CONFIG: {
    "401k": { ...mockAccountConfig, displayLabel: "401k" },
    ira: { ...mockAccountConfig, displayLabel: "IRA" },
    hsa: {
      ...mockAccountConfig,
      displayLabel: "HSA",
      supportsRothSplit: false,
      taxBucketKey: "hsa",
    },
    brokerage: {
      ...mockAccountConfig,
      displayLabel: "Brokerage",
      supportsRothSplit: false,
      taxBucketKey: "afterTax",
    },
  },
  getTraditionalBalance: () => 0,
  getRothBalance: () => 0,
  getTotalBalance: () => 0,
  buildCategoryRecord: () => ({}),
  getDefaultAccumulationOrder: () => ["401k", "ira", "hsa", "brokerage"],
  getDefaultDecumulationOrder: () => ["401k", "ira", "hsa", "brokerage"],
}));

vi.mock("@/lib/config/display-labels", () => ({
  TAX_TREATMENT_TO_TAX_TYPE: {},
}));

// ---------------------------------------------------------------------------
// Helpers — build minimal mock state matching useProjectionState return
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function baseMockState(overrides: Record<string, unknown> = {}): any {
  return {
    // Form state
    accumOverrides: [],
    setAccumOverrides: vi.fn(),
    decumOverrides: [],
    setDecumOverrides: vi.fn(),
    showAccumForm: false,
    setShowAccumForm: vi.fn(),
    accumForm: {
      year: "",
      personName: "",
      reset: false,
      contributionRate: "",
      routingMode: "",
      accountOrder: ["401k", "ira", "hsa", "brokerage"],
      accountSplits: {},
      accountCaps: {},
      taxSplits: {},
      taxTypeCaps: { traditional: "", roth: "" },
      lumpSums: [],
      notes: "",
    },
    setAccumForm: vi.fn(),
    showDecumForm: false,
    setShowDecumForm: vi.fn(),
    decumForm: {
      year: "",
      personName: "",
      reset: false,
      withdrawalRate: "",
      rothConversionTarget: "",
      withdrawalRoutingMode: "",
      withdrawalOrder: ["401k", "ira", "hsa", "brokerage"],
      withdrawalSplits: {},
      withdrawalAccountCaps: {},
      withdrawalTaxPreference: {},
      withdrawalTaxTypeCaps: { traditional: "", roth: "" },
      lumpSums: [],
      notes: "",
    },
    setDecumForm: vi.fn(),
    showSalaryForm: false,
    setShowSalaryForm: vi.fn(),
    salaryForm: {
      year: "",
      source: "custom",
      profileId: "",
      value: "",
      notes: "",
    },
    setSalaryForm: vi.fn(),
    showBudgetForm: false,
    setShowBudgetForm: vi.fn(),
    budgetForm: {
      year: "",
      source: "custom",
      profileId: "",
      profileColumn: "0",
      value: "",
      notes: "",
    },
    setBudgetForm: vi.fn(),
    showLifeOverrides: false,
    setShowLifeOverrides: vi.fn(),
    personFilter: "all",
    isPersonFiltered: false,
    personFilterName: "",
    dbSalaryOverrides: [],
    dbBudgetOverrides: [],
    salaryByPerson: {},
    budgetProfileSummaries: [],
    enginePeople: [{ id: 1, name: "Alice", birthYear: 1990 }],
    primaryPersonId: 1,
    salaryOverridePersonId: 1,
    combinedSalary: 120000,
    annualExpenses: 60000,
    rothBracketPresets: ["0", "0.12", "0.22"],
    handleAddAccumOverride: vi.fn(),
    handleAddDecumOverride: vi.fn(),
    createSalaryOverride: { mutate: vi.fn() },
    deleteSalaryOverride: { mutate: vi.fn() },
    createBudgetOverride: { mutate: vi.fn() },
    deleteBudgetOverride: { mutate: vi.fn() },
    contribProfileSummaries: [],
    engineSettings: {
      retirementAge: 65,
      endAge: 95,
      salaryAnnualIncrease: 0.03,
      annualInflation: 0.025,
    },

    // Queries
    engineQuery: { isLoading: false, error: null },
    mcPrefetchQuery: { data: null, isFetching: false },
    mcQuery: { data: null, error: null },
    mcLoading: false,
    mcBandsByYear: null,
    mcIsPrefetch: false,
    mcChartPending: false,

    // Derived
    result: null,
    getPersonYearTotals: () => null,
    personDepletionInfo: null,
    visibleColumns: {
      balanceTaxTypes: new Set(["preTax", "taxFree", "hsa", "afterTax"]),
      balanceAccts: new Set(["401k_trad"]),
    },
    columnLabel: { "401k_trad": "401k Trad" },
    baseYear: 2026,
    deflate: (v: number) => v,

    // View state
    projectionMode: "deterministic" as const,
    setProjectionMode: vi.fn(),
    mcTrials: 1000,
    setMcTrials: vi.fn(),
    mcPreset: "default",
    setMcPreset: vi.fn(),
    mcTaxMode: "simple",
    setMcTaxMode: vi.fn(),
    dollarMode: "real",
    setDollarMode: vi.fn(),
    balanceView: "taxType",
    setBalanceView: vi.fn(),
    contribView: "account",
    setContribView: vi.fn(),
    showAllYears: false,
    setShowAllYears: vi.fn(),
    fanBandRange: "p25-p75",
    setFanBandRange: vi.fn(),
    showMethodology: false,
    setShowMethodology: vi.fn(),
    showAccumMethodology: false,
    setShowAccumMethodology: vi.fn(),
    showDecumMethodology: false,
    setShowDecumMethodology: vi.fn(),
    showValidation: false,
    setShowValidation: vi.fn(),
    showAssumptions: false,
    setShowAssumptions: vi.fn(),
    setPersonFilter: vi.fn(),
    mcAssetClassOverrides: null,
    setMcAssetClassOverrides: vi.fn(),
    showDecumConfig: false,
    setShowDecumConfig: vi.fn(),
    withdrawalRoutingMode: "waterfall",
    setWithdrawalRoutingMode: vi.fn(),
    withdrawalOrder: ["401k", "ira", "hsa", "brokerage"],
    setWithdrawalOrder: vi.fn(),
    withdrawalSplits: {},
    setWithdrawalSplits: vi.fn(),
    withdrawalTaxPref: {},
    setWithdrawalTaxPref: vi.fn(),
    updateGlidePath: { mutate: vi.fn() },
    updateInflationRisk: { mutate: vi.fn() },
    updateClampBounds: { mutate: vi.fn() },
    updateAssetClassOverrides: { mutate: vi.fn() },
    updateInflationOverrides: { mutate: vi.fn() },

    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// OverridesPanel (shell)
// ---------------------------------------------------------------------------

describe("OverridesPanel", () => {
  it("renders summary counts", async () => {
    const { OverridesPanel } =
      await import("@/components/cards/projection/overrides-panel");
    const s = baseMockState({
      accumOverrides: [{ year: 2030 }, { year: 2035 }],
      decumOverrides: [{ year: 2060 }],
      dbSalaryOverrides: [
        { id: 1, projectionYear: 2030, overrideSalary: 100000 },
      ],
      dbBudgetOverrides: [],
    });
    render(<OverridesPanel state={s} />);
    // 2 saving overrides
    expect(screen.getByText("2")).toBeInTheDocument();
    // 1 withdrawal + 1 life change — both show "1", use getAllByText
    const ones = screen.getAllByText("1");
    expect(ones.length).toBe(2);
  });

  it("renders all three section headers", async () => {
    const { OverridesPanel } =
      await import("@/components/cards/projection/overrides-panel");
    render(<OverridesPanel state={baseMockState()} />);
    expect(screen.getByText("Pre-Retirement")).toBeInTheDocument();
    expect(screen.getByText("Post-Retirement")).toBeInTheDocument();
    expect(screen.getByText(/Contribution/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// SavingOverridesSection
// ---------------------------------------------------------------------------

describe("SavingOverridesSection", () => {
  it("shows + Add button when form is closed", async () => {
    const { SavingOverridesSection } =
      await import("@/components/cards/projection/overrides-saving-section");
    render(<SavingOverridesSection state={baseMockState()} />);
    expect(screen.getByText("+ Add")).toBeInTheDocument();
  });

  it("shows Cancel when form is open", async () => {
    const { SavingOverridesSection } =
      await import("@/components/cards/projection/overrides-saving-section");
    render(
      <SavingOverridesSection state={baseMockState({ showAccumForm: true })} />,
    );
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("renders existing override badges", async () => {
    const { SavingOverridesSection } =
      await import("@/components/cards/projection/overrides-saving-section");
    const s = baseMockState({
      accumOverrides: [
        { year: 2030, contributionRate: 0.25, notes: "Max out" },
      ],
    });
    render(<SavingOverridesSection state={s} />);
    expect(screen.getByText("2030+")).toBeInTheDocument();
    expect(screen.getByText("(Max out)")).toBeInTheDocument();
  });

  it("calls setShowAccumForm on + Add click", async () => {
    const { SavingOverridesSection } =
      await import("@/components/cards/projection/overrides-saving-section");
    const s = baseMockState();
    render(<SavingOverridesSection state={s} />);
    fireEvent.click(screen.getByText("+ Add"));
    expect(s.setShowAccumForm).toHaveBeenCalledWith(true);
  });

  it("renders reset badge text", async () => {
    const { SavingOverridesSection } =
      await import("@/components/cards/projection/overrides-saving-section");
    const s = baseMockState({
      accumOverrides: [{ year: 2035, reset: true }],
    });
    render(<SavingOverridesSection state={s} />);
    expect(screen.getByText("Reset to defaults")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// WithdrawalOverridesSection
// ---------------------------------------------------------------------------

describe("WithdrawalOverridesSection", () => {
  it("renders existing withdrawal overrides", async () => {
    const { WithdrawalOverridesSection } =
      await import("@/components/cards/projection/overrides-withdrawal-section");
    const s = baseMockState({
      decumOverrides: [
        { year: 2060, withdrawalRate: 0.035, notes: "Reduce spending" },
      ],
    });
    render(<WithdrawalOverridesSection state={s} />);
    expect(screen.getByText("2060+")).toBeInTheDocument();
    expect(screen.getByText("(Reduce spending)")).toBeInTheDocument();
  });

  it("calls setShowDecumForm on + Add click", async () => {
    const { WithdrawalOverridesSection } =
      await import("@/components/cards/projection/overrides-withdrawal-section");
    const s = baseMockState();
    render(<WithdrawalOverridesSection state={s} />);
    fireEvent.click(screen.getByText("+ Add"));
    expect(s.setShowDecumForm).toHaveBeenCalledWith(true);
  });
});

// ---------------------------------------------------------------------------
// LifeChangesSection
// ---------------------------------------------------------------------------

describe("LifeChangesSection", () => {
  it("shows collapsed summary when not expanded", async () => {
    const { LifeChangesSection } =
      await import("@/components/cards/projection/overrides-life-section");
    render(
      <LifeChangesSection
        state={baseMockState({ dbSalaryOverrides: [], dbBudgetOverrides: [] })}
      />,
    );
    expect(screen.getByText("None")).toBeInTheDocument();
  });

  it("shows override count when collapsed", async () => {
    const { LifeChangesSection } =
      await import("@/components/cards/projection/overrides-life-section");
    const s = baseMockState({
      dbSalaryOverrides: [
        { id: 1, projectionYear: 2030, overrideSalary: 150000 },
        { id: 2, projectionYear: 2035, overrideSalary: 180000 },
      ],
    });
    render(<LifeChangesSection state={s} />);
    expect(screen.getByText("2 contribution overrides")).toBeInTheDocument();
  });

  it("toggles expand/collapse", async () => {
    const { LifeChangesSection } =
      await import("@/components/cards/projection/overrides-life-section");
    const s = baseMockState();
    render(<LifeChangesSection state={s} />);
    fireEvent.click(screen.getByText("Expand"));
    expect(s.setShowLifeOverrides).toHaveBeenCalledWith(true);
  });

  it("shows baseline info when expanded", async () => {
    const { LifeChangesSection } =
      await import("@/components/cards/projection/overrides-life-section");
    const s = baseMockState({ showLifeOverrides: true });
    render(<LifeChangesSection state={s} />);
    expect(screen.getByText(/Current income.*\$120,000/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ProjectionHeroKpis
// ---------------------------------------------------------------------------

describe("ProjectionHeroKpis", () => {
  const minResult = {
    projectionByYear: [
      {
        year: 2026,
        age: 36,
        endBalance: 500000,
        balanceByTaxType: {
          preTax: 300000,
          taxFree: 150000,
          hsa: 50000,
          afterTax: 0,
          afterTaxBasis: 0,
        },
        balanceByAccount: {},
        phase: "accumulation",
      },
      {
        year: 2055,
        age: 65,
        endBalance: 2000000,
        balanceByTaxType: {
          preTax: 1000000,
          taxFree: 700000,
          hsa: 300000,
          afterTax: 0,
          afterTaxBasis: 0,
        },
        balanceByAccount: {},
        phase: "decumulation",
      },
    ],
    portfolioDepletionAge: null,
    portfolioDepletionYear: null,
    sustainableWithdrawal: 80000,
    firstOverflowAge: null,
  };

  it("renders deterministic hero when no MC data", async () => {
    const { ProjectionHeroKpis } =
      await import("@/components/cards/projection/projection-hero-kpis");
    const s = baseMockState({ result: minResult });
    render(<ProjectionHeroKpis s={s} />);
    expect(screen.getByText("Nest Egg at Retirement")).toBeInTheDocument();
    expect(screen.getByText("Peak Balance")).toBeInTheDocument();
    expect(screen.getByText("Funding Duration")).toBeInTheDocument();
    expect(screen.getByText(/Lasts/)).toBeInTheDocument();
  });

  it("returns null when result is null", async () => {
    const { ProjectionHeroKpis } =
      await import("@/components/cards/projection/projection-hero-kpis");
    const { container } = render(<ProjectionHeroKpis s={baseMockState()} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders MC hero when MC data available", async () => {
    const { ProjectionHeroKpis } =
      await import("@/components/cards/projection/projection-hero-kpis");
    const mcData = {
      result: {
        successRate: 0.92,
        percentileBands: [
          {
            age: 65,
            year: 2055,
            p5: 800000,
            p10: 1000000,
            p25: 1500000,
            p50: 2000000,
            p75: 2800000,
            p90: 3500000,
            p95: 4000000,
          },
        ],
        distributions: {
          depletionAge: null,
          terminalBalance: { median: 1500000 },
        },
        medianEndBalance: 1500000,
        numTrials: 1000,
      },
    };
    const s = baseMockState({
      result: minResult,
      mcQuery: { data: mcData, error: null },
      mcLoading: false,
    });
    render(<ProjectionHeroKpis s={s} />);
    expect(screen.getByText("92%")).toBeInTheDocument();
    expect(screen.getByText("Success Rate")).toBeInTheDocument();
    expect(screen.getByText("Funding Outlook")).toBeInTheDocument();
    expect(screen.getByText("Fully Funded")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ProjectionChartSkeleton
// ---------------------------------------------------------------------------

describe("ProjectionChartSkeleton", () => {
  it("renders loading state", async () => {
    const { ProjectionChartSkeleton } =
      await import("@/components/cards/projection/projection-chart");
    render(<ProjectionChartSkeleton />);
    expect(screen.getByText("Balance Projection")).toBeInTheDocument();
    expect(screen.getByText(/Simulating/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ProjectionChart
// ---------------------------------------------------------------------------

describe("ProjectionChart", () => {
  const chartResult = {
    projectionByYear: Array.from({ length: 10 }, (_, i) => ({
      year: 2026 + i,
      age: 36 + i,
      endBalance: 500000 + i * 50000,
      balanceByTaxType: {
        preTax: 300000 + i * 30000,
        taxFree: 150000 + i * 15000,
        hsa: 50000 + i * 5000,
        afterTax: 0,
        afterTaxBasis: 0,
      },
      balanceByAccount: {},
      phase: "accumulation",
    })),
    portfolioDepletionAge: null,
    portfolioDepletionYear: null,
  };

  it("returns null when result is null", async () => {
    const { ProjectionChart } =
      await import("@/components/cards/projection/projection-chart");
    const { container } = render(<ProjectionChart s={baseMockState()} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders chart with title", async () => {
    const { ProjectionChart } =
      await import("@/components/cards/projection/projection-chart");
    const s = baseMockState({ result: chartResult });
    render(<ProjectionChart s={s} />);
    expect(screen.getByText("Balance Projection")).toBeInTheDocument();
    expect(screen.getByTestId("responsive-container")).toBeInTheDocument();
  });

  it("shows person filter name when filtered", async () => {
    const { ProjectionChart } =
      await import("@/components/cards/projection/projection-chart");
    const s = baseMockState({
      result: chartResult,
      isPersonFiltered: true,
      personFilterName: "Alice",
    });
    render(<ProjectionChart s={s} />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// McDepletionCallout
// ---------------------------------------------------------------------------

describe("McDepletionCallout", () => {
  it("returns null when no MC data", async () => {
    const { McDepletionCallout } =
      await import("@/components/cards/projection/projection-mc-results");
    const { container } = render(<McDepletionCallout s={baseMockState()} />);
    expect(container.innerHTML).toBe("");
  });

  it("returns null when no depletion age in MC", async () => {
    const { McDepletionCallout } =
      await import("@/components/cards/projection/projection-mc-results");
    const s = baseMockState({
      result: { projectionByYear: [{ age: 36, year: 2026 }] },
      mcQuery: {
        data: {
          result: {
            successRate: 0.95,
            distributions: {
              depletionAge: null,
              terminalBalance: { median: 1000000 },
            },
          },
        },
        error: null,
      },
    });
    const { container } = render(<McDepletionCallout s={s} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders depletion warning when present", async () => {
    const { McDepletionCallout } =
      await import("@/components/cards/projection/projection-mc-results");
    const s = baseMockState({
      result: { projectionByYear: [{ age: 36, year: 2026 }] },
      mcQuery: {
        data: {
          result: {
            successRate: 0.72,
            distributions: {
              depletionAge: { median: 88, p10: 82, p25: 85, p75: 92, p90: 95 },
              terminalBalance: {
                median: 50000,
                p10: 0,
                p25: 10000,
                p75: 200000,
                p90: 500000,
              },
            },
          },
        },
        error: null,
      },
    });
    render(<McDepletionCallout s={s} />);
    expect(screen.getByText(/28% of futures/)).toBeInTheDocument();
    expect(screen.getByText(/age 88/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// McResultsSection
// ---------------------------------------------------------------------------

describe("McResultsSection", () => {
  it("returns null when not in MC mode", async () => {
    const { McResultsSection } =
      await import("@/components/cards/projection/projection-mc-results");
    const { container } = render(
      <McResultsSection
        s={baseMockState({ projectionMode: "deterministic" })}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("shows loading spinner when MC is running", async () => {
    const { McResultsSection } =
      await import("@/components/cards/projection/projection-mc-results");
    const s = baseMockState({
      projectionMode: "monteCarlo",
      mcLoading: true,
    });
    render(<McResultsSection s={s} />);
    expect(screen.getByText(/Running 1,000 simulations/)).toBeInTheDocument();
  });

  it("shows error message on MC failure", async () => {
    const { McResultsSection } =
      await import("@/components/cards/projection/projection-mc-results");
    const s = baseMockState({
      projectionMode: "monteCarlo",
      mcQuery: { data: null, error: { message: "Timeout" } },
    });
    render(<McResultsSection s={s} />);
    expect(screen.getByText(/Monte Carlo failed: Timeout/)).toBeInTheDocument();
  });

  it("shows no-data message when no MC results", async () => {
    const { McResultsSection } =
      await import("@/components/cards/projection/projection-mc-results");
    const s = baseMockState({
      projectionMode: "monteCarlo",
      mcQuery: { data: null, error: null },
    });
    render(<McResultsSection s={s} />);
    expect(screen.getByText(/No Monte Carlo data/)).toBeInTheDocument();
  });
});
