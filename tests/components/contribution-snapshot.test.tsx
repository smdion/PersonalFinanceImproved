import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ContributionSnapshot } from "@/components/paycheck/contribution-snapshot";

vi.mock("@/components/ui/help-tip", () => ({
  HelpTip: () => null,
}));

vi.mock("@/lib/hooks/use-persisted-setting", () => ({
  usePersistedSetting: () => [null, vi.fn()],
}));

vi.mock("@/lib/context/scenario-context", () => ({
  useScenario: () => ({ viewMode: "projected" }),
}));

vi.mock("@/lib/config/account-types", () => {
  const mk = (matchCountsTowardLimit = false) => ({
    matchCountsTowardLimit,
    irsLimitKeys: {},
  });
  return {
    categoriesWithIrsLimit: () => ["401k", "hsa"],
    getAccountTypeConfig: (cat: string) => mk(cat === "hsa" ? true : false),
    isRetirementParent: (pc: string) => pc === "Retirement",
    isPortfolioParent: (pc: string) => pc === "Portfolio",
  };
});

vi.mock("@/lib/utils/colors", () => ({
  accountColor: () => "bg-blue-500",
  accountMatchColor: () => "bg-blue-200",
  accountBorderColor: () => "border-blue-300",
  accountTextColor: () => "text-blue-600",
}));

let queryData: unknown;
let queryLoading = false;
let queryError: unknown = null;

vi.mock("@/lib/trpc", () => ({
  trpc: {
    contribution: {
      computeSummary: {
        useQuery: () => ({
          data: queryData,
          isLoading: queryLoading,
          error: queryError,
        }),
      },
    },
  },
}));

const basePerson = { id: 1, name: "Alice" };

function makeAccountType(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    accountType: "401k",
    categoryKey: "401k",
    parentCategory: "Retirement",
    hasDiscountBar: false,
    employerMatchLabel: "match",
    isJoint: false,
    limit: 23000,
    currentPctOfSalary: 10,
    bonusContrib: 0,
    employeeContrib: 5000,
    employerMatch: 1000,
    totalContrib: 6000,
    tradContrib: 5000,
    taxFreeContrib: 0,
    views: {
      projected: {
        employeeContrib: 5000,
        employerMatch: 1000,
        totalContrib: 6000,
        fundingPct: 0.25,
        fundingMissing: 0,
        pctOfSalaryToMax: 40,
      },
    },
    ...overrides,
  };
}

function makeData(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    people: [
      {
        person: basePerson,
        periodsPerYear: 26,
        accountTypes: [makeAccountType()],
        totals: {
          views: {
            projected: {
              retirementWithoutMatch: 5000,
              retirementWithMatch: 6000,
              portfolioWithoutMatch: 0,
              portfolioWithMatch: 0,
              totalWithoutMatch: 5000,
              totalWithMatch: 6000,
            },
          },
        },
      },
    ],
    jointAccountTypes: [],
    jointTotals: { totalWithoutMatch: 0, totalWithMatch: 0 },
    limits: {},
    ...overrides,
  };
}

describe("ContributionSnapshot", () => {
  beforeEach(() => {
    queryData = undefined;
    queryLoading = false;
    queryError = null;
  });

  it("renders nothing while loading", () => {
    queryData = undefined;
    queryLoading = true;
    queryError = null;
    const { container } = render(<ContributionSnapshot />);
    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
  });

  it("renders an error message on query error", () => {
    queryData = undefined;
    queryLoading = false;
    queryError = new Error("boom");
    render(<ContributionSnapshot />);
    expect(
      screen.getByText("Failed to load contribution snapshot"),
    ).toBeInTheDocument();
  });

  it("renders nothing when there is no people data", () => {
    queryData = { people: [], jointAccountTypes: [] };
    queryLoading = false;
    queryError = null;
    const { container } = render(<ContributionSnapshot />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the household snapshot heading with seeded data", () => {
    queryData = makeData();
    queryLoading = false;
    queryError = null;
    render(<ContributionSnapshot />);
    expect(
      screen.getByText("Household Contribution Snapshot"),
    ).toBeInTheDocument();
  });

  it("renders per-person account type card with employee contribution", () => {
    queryData = makeData();
    render(<ContributionSnapshot />);
    expect(screen.getByText("401k")).toBeInTheDocument();
    expect(screen.getAllByText("$5,000.00").length).toBeGreaterThan(0);
  });

  it("renders household totals section", () => {
    queryData = makeData();
    render(<ContributionSnapshot />);
    expect(screen.getByText("Retirement")).toBeInTheDocument();
    expect(screen.getByText("Brokerage")).toBeInTheDocument();
    expect(screen.getByText("Total Portfolio")).toBeInTheDocument();
  });

  it("renders joint account type once without per-person breakdown", () => {
    queryData = makeData({
      people: [
        {
          person: basePerson,
          periodsPerYear: 26,
          accountTypes: [],
          totals: {
            views: {
              projected: {
                retirementWithoutMatch: 0,
                retirementWithMatch: 0,
                portfolioWithoutMatch: 0,
                portfolioWithMatch: 0,
                totalWithoutMatch: 0,
                totalWithMatch: 0,
              },
            },
          },
        },
      ],
      jointAccountTypes: [
        {
          accountType: "brokerage",
          categoryKey: "brokerage",
          parentCategory: "Portfolio",
          hasDiscountBar: false,
          employerMatchLabel: "match",
          isJoint: true,
          employeeContrib: 2000,
          employerMatch: 0,
          totalContrib: 2000,
        },
      ],
    });
    render(<ContributionSnapshot />);
    expect(screen.getByText("brokerage")).toBeInTheDocument();
    expect(screen.getByText(/\(Joint\)/)).toBeInTheDocument();
  });
});
