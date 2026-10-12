/** Portfolio account card → Holdings & Deposits. Invented data only. */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const confirmStandIn = vi.fn();
const updateCostBasis = vi.fn();
const mutation = (fn = vi.fn()) => ({
  useMutation: () => ({ mutate: fn, isPending: false, isSuccess: false }),
});
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      investments: {
        invalidate: vi.fn(),
        getAccountInsights: { invalidate: vi.fn() },
      },
      performance: { invalidate: vi.fn() },
    }),
    performance: { updateCostBasis: mutation(updateCostBasis) },
    investments: {
      confirmStandIn: mutation(confirmStandIn),
      rejectStandIn: mutation(),
      findStandIn: mutation(),
      checkStandIn: mutation(),
      setUserFacts: mutation(),
      clearUserFacts: mutation(),
    },
  },
}));

import type { AccountInsight } from "@/components/portfolio/account-live-data";
import type { Holding } from "@/components/investments/fund-holding-row";

const { AccountLiveSection, AccountLiveSummary } =
  await import("@/components/portfolio/account-live-data");

const zero = {
  us_equity: 0,
  intl_equity: 0,
  us_bond: 0,
  intl_bond: 0,
  tips: 0,
  cash: 0,
  other: 0,
};
const insight: AccountInsight = {
  performanceAccountId: 1,
  status: "linked",
  live: { total: 1234.5, asOf: "2026-10-10" },
  feeds: [{ id: 9, name: "Example Bank Plan", part: null }],
  unlinkedParts: ["Alice — Roth"],
  sinceSnapshot: {
    snapshotDate: "2026-10-01",
    change: 150,
    covered: true,
    added: 100,
    moved: 0,
    markets: 50,
    uncertainCount: 0,
  },
  unplaced: [
    { name: "Example Bank Traditional IRA", balance: 0.19, reason: "no_part" },
  ],
  mix: { buckets: { ...zero, us_equity: 1000 }, unknown: 0, total: 1000 },
  costBasis: {
    stored: 500,
    suggested: 800,
    unknownValue: 0,
    complete: true,
    asOf: "2026-10-09",
  },
  cost: { expenseRatio: 0.0005, yearlyCost: 0.5, coveredShare: 1 },
  deposits: {
    verdict: "lower",
    recent: [{ day: "2026-10-01", amount: 100 }],
    paydays: 4,
    typical: 100,
    everyDays: 14,
    observedAnnual: 2607.14,
    expectedAnnual: 5000,
  },
};
const holding: Holding = {
  securityId: 5,
  symbol: "EXMPX",
  symbolConfirmed: true,
  name: "Example Index Fund",
  shares: 10,
  value: 1000,
  valueBasis: "priced",
  valuedOn: "2026-10-10",
  facts: { composition: null, expenseRatio: null, stale: false },
  factsBasis: "standin",
  factsSeriesName: "Example Registered Fund",
  standInPending: true,
};

describe("AccountLiveSection", () => {
  it("shows link coverage, the deposit check and the stand-in controls", () => {
    render(<AccountLiveSection insight={insight} holdings={[holding]} />);
    expect(
      screen.getByText(/Not linked yet: Alice — Roth/),
    ).toBeInTheDocument();
    expect(screen.getByText(/your paycheck setup says/)).toBeInTheDocument();
    expect(
      screen.getByText(/you added \$100.*markets \+\$50/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "EXMPX" })).toHaveAttribute(
      "href",
      "https://finance.yahoo.com/quote/EXMPX",
    );
    // Two "Use it" buttons: the stand-in fund (first) and the cost basis.
    const [standIn, cost] = screen.getAllByRole("button", { name: "Use it" });
    fireEvent.click(standIn!);
    expect(confirmStandIn).toHaveBeenCalledWith({ securityId: 5 });
    fireEvent.click(cost!);
    expect(updateCostBasis).toHaveBeenCalledWith({
      performanceAccountId: 1,
      costBasis: "800.00",
    });
  });

  it("summarises the live balance for the card header", () => {
    render(<AccountLiveSummary insight={insight} />);
    expect(screen.getByText(/Live \$1,234/)).toBeInTheDocument();
    expect(screen.getByText(/partly linked/)).toBeInTheDocument();
  });
});
