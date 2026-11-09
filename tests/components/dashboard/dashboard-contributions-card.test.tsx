import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import {
  holdMutation,
  resetTrpcMock,
  setQuery,
  setQueryState,
  type MockOutput,
} from "../trpc-mock";

// Direct smoke test for src/components/dashboard/contributions-card.tsx.
// tests/components/dashboard/dashboard.test.tsx mocks out all dashboard cards at the
// page level, so individual cards (including this one) have zero direct
// coverage. This card is the most complex of the dashboard cards (per-account
// funding bars, joint accounts, ESPP-style discount bars, household totals).
//
// Hook modules (useScenario, usePersistedSetting) are
// mocked directly rather than reaching through tRPC, since they each layer
// their own tRPC calls internally — mocking the hook surface is simpler and
// matches how leaf components consume them.

vi.mock("@/lib/context/scenario-context", () => ({
  useScenario: () => ({ viewMode: "projected" as const, isInScenario: false }),
}));
vi.mock("@/lib/context/user-context", () => ({
  useUser: () => ({ role: "viewer", name: "Test", permissions: [] }),
  isAdmin: (u: { role: string }) => u.role === "admin",
  hasPermission: () => true,
}));
vi.mock("@/lib/hooks/use-persisted-setting", () => ({
  usePersistedSetting: (_key: string, defaultValue: unknown) => [
    defaultValue,
    vi.fn(),
  ],
}));

const CONTRIB = "contribution.computeSummary";
const PACE = "investments.computeSavingsThisYear";
/** What contribution.computeSummary answers. */
function contribQueryIs({
  data,
  isLoading,
  error,
}: {
  data: MockOutput<typeof CONTRIB> | undefined;
  isLoading: boolean;
  error: unknown;
}) {
  setQuery(CONTRIB, data);
  setQueryState(CONTRIB, { isLoading, error });
}
/** What investments.computeSavingsThisYear answers. */
function paceQueryIs({ data }: { data: MockOutput<typeof PACE> | undefined }) {
  setQuery(PACE, data);
}

vi.mock("@/lib/hooks/use-high-income-line", () => ({
  useHighIncomeLine: () => ({
    threshold: 200_000,
    basis: "MFJ",
    defaultThreshold: 200_000,
    setSaved: vi.fn(),
  }),
}));

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("../trpc-mock")).trpc,
}));

import { ContributionsCard } from "@/components/dashboard/contributions-card";

const view = (
  employeeContrib: number,
  employerMatch: number,
  limit: number,
) => ({
  employeeContrib,
  employerMatch,
  totalContrib: employeeContrib + employerMatch,
  fundingPct: limit > 0 ? employeeContrib / limit : 0,
  fundingMissing: limit > 0 ? Math.max(0, limit - employeeContrib) : 0,
  pctOfSalaryToMax: 5,
});

const acct401k = {
  performanceAccountIds: [1],
  accountType: "401(k)",
  categoryKey: "401k",
  parentCategory: "Retirement",
  limit: 23500,
  employeeContrib: 10000,
  employerMatch: 3000,
  totalContrib: 13000,
  views: {
    projected: view(10000, 3000, 23500),
    ytd: view(10000, 3000, 23500),
    blended: view(10000, 3000, 23500),
  },
  ytdDataStale: false,
  currentPctOfSalary: 10,
  tradContrib: 10000,
  taxFreeContrib: 0,
  afterTaxContrib: 0,
  hsaContrib: 0,
  bonusContrib: 0,
  isJoint: false,
  hasDiscountBar: false,
  employerMatchLabel: "Match",
};

const acctEspp = {
  accountType: "ESPP",
  performanceAccountIds: [],
  categoryKey: "espp",
  parentCategory: "Portfolio",
  limit: 0,
  employeeContrib: 5000,
  employerMatch: 750,
  totalContrib: 5750,
  views: {
    projected: view(5000, 750, 0),
    ytd: view(5000, 750, 0),
    blended: view(5000, 750, 0),
  },
  ytdDataStale: false,
  currentPctOfSalary: null,
  tradContrib: 0,
  taxFreeContrib: 0,
  afterTaxContrib: 5000,
  hsaContrib: 0,
  bonusContrib: 0,
  isJoint: false,
  hasDiscountBar: true,
  employerMatchLabel: "Discount",
};

const totalsViews = {
  projected: {
    retirementWithoutMatch: 10000,
    retirementWithMatch: 13000,
    portfolioWithoutMatch: 5000,
    portfolioWithMatch: 5750,
    totalWithoutMatch: 15000,
    totalWithMatch: 18750,
  },
  ytd: {
    retirementWithoutMatch: 10000,
    retirementWithMatch: 13000,
    portfolioWithoutMatch: 5000,
    portfolioWithMatch: 5750,
    totalWithoutMatch: 15000,
    totalWithMatch: 18750,
  },
  blended: {
    retirementWithoutMatch: 10000,
    retirementWithMatch: 13000,
    portfolioWithoutMatch: 5000,
    portfolioWithMatch: 5750,
    totalWithoutMatch: 15000,
    totalWithMatch: 18750,
  },
};

const mockData = {
  people: [
    {
      person: { id: 1, name: "Alice" },
      periodsPerYear: 26,
      accountTypes: [acct401k, acctEspp],
      totals: { views: totalsViews },
    },
  ],
  jointAccountTypes: [],
  jointTotals: { totalWithoutMatch: 0, totalWithMatch: 0 },
};

beforeEach(() => {
  resetTrpcMock();
  // Reached via useEffectiveSalaryProfileId → useActiveSalaryProfile, and
  // useEffectiveContributionProfileId → useActiveContributionProfile. An empty list
  // is the "nothing to resolve" case: the hook leaves the active id alone
  // rather than re-pointing it.
  setQuery("salaryProfile.list", []);
  setQuery("contributionProfile.list", []);
  holdMutation("salaryProfile.setActive");
  holdMutation("contributionProfile.setActive");
  contribQueryIs({ data: undefined, isLoading: true, error: null });
});

describe("ContributionsCard smoke", () => {
  it("renders a loading card while the query is pending", () => {
    contribQueryIs({ data: undefined, isLoading: true, error: null });
    render(<ContributionsCard />);
    expect(screen.getByText("Contributions")).toBeInTheDocument();
  });

  it("renders an error card when the query fails", () => {
    contribQueryIs({
      data: undefined,
      isLoading: false,
      error: new Error("x"),
    });
    render(<ContributionsCard />);
    expect(
      screen.getByText("Couldn't load Contributions. Try again."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("renders per-person account types with funding bars and household totals", () => {
    contribQueryIs({ data: mockData, isLoading: false, error: null });
    render(<ContributionsCard />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("401(k)")).toBeInTheDocument();
    expect(screen.getByText("ESPP")).toBeInTheDocument();
    // Funding pct line for the limited (401k) account
    expect(screen.getByText(/of \$23,500\.00/)).toBeInTheDocument();
    // ESPP has no IRS limit — discount bar branch
    expect(screen.getByText(/Discount/)).toBeInTheDocument();
  });

  it("shows whether money is going in as set up, and what's saved so far", () => {
    contribQueryIs({ data: mockData, isLoading: false, error: null });
    paceQueryIs({
      data: {
        accounts: [{ performanceAccountId: 1, status: "on_pace" }],
        total: { saved: 9000, unposted: 500, status: "on_pace" },
      },
    });
    render(<ContributionsCard />);
    expect(screen.getAllByText("On pace").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Saved so far this year/)).toBeInTheDocument();
    expect(screen.getByText(/on its way/)).toBeInTheDocument();
    paceQueryIs({ data: undefined });
  });

  it("renders joint accounts in their own section when present", () => {
    contribQueryIs({
      data: {
        ...mockData,
        jointAccountTypes: [
          {
            ...acct401k,
            accountType: "Joint Brokerage",
            categoryKey: "brokerage",
            isJoint: true,
            limit: 0,
            hasDiscountBar: false,
          },
        ],
        jointTotals: { totalWithoutMatch: 10000, totalWithMatch: 13000 },
      },
      isLoading: false,
      error: null,
    });
    render(<ContributionsCard />);
    expect(screen.getByText("Joint")).toBeInTheDocument();
    expect(screen.getByText("Joint Brokerage")).toBeInTheDocument();
  });

  it("shows the 'Over' badge when funding exceeds the over-limit threshold", () => {
    const overAccount = {
      ...acct401k,
      views: {
        ...acct401k.views,
        projected: view(24000, 3000, 23500),
      },
    };
    contribQueryIs({
      data: {
        ...mockData,
        people: [{ ...mockData.people[0], accountTypes: [overAccount] }],
      },
      isLoading: false,
      error: null,
    });
    render(<ContributionsCard />);
    expect(screen.getByText("Over")).toBeInTheDocument();
  });
});
