/** A suggested stand-in fund: preview and recommendation. Invented data only. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Holding } from "@/components/investments/fund-holding-row";

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./trpc-mock")).trpc,
}));
import { resetTrpcMock, setMutationResult } from "./trpc-mock";

// Each call succeeds straight away (trpc-mock's default); `calls` records
// what was sent, in order across procedures.
const calls: string[] = [];
const STAND_IN_MUTATIONS = [
  "confirmStandIn",
  "rejectStandIn",
  "findStandIn",
  "checkStandIn",
  "setUserFacts",
  "clearUserFacts",
] as const;
beforeEach(() => {
  resetTrpcMock();
  for (const name of STAND_IN_MUTATIONS)
    setMutationResult(`investments.${name}`, () => {
      calls.push(name);
      return {};
    });
});
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
}));

const { HoldingRow } =
  await import("@/components/investments/fund-holding-row");

const holding = (standInPreview: Holding["standInPreview"]): Holding => ({
  securityId: 5,
  symbol: null,
  symbolConfirmed: false,
  name: "Example Plan Index Fund",
  shares: 10,
  avgCostPerShare: null,
  value: 1000,
  valueBasis: "reported",
  valuedOn: "2026-10-09",
  facts: { composition: null, expenseRatio: null, stale: false },
  factsBasis: "standin",
  factsSeriesName: "Example Registered Index Fund",
  standInPending: true,
  standInPreview,
});
const preview = (coverage: number | null) => ({
  coverage,
  mix:
    coverage === null
      ? null
      : {
          us_equity: 0,
          intl_equity: coverage,
          us_bond: 0,
          intl_bond: 0,
          tips: 0,
          cash: 0,
          other: 0,
        },
  expenseRatio: 0.0032,
  asOf: "2026-06-30",
  checkedAt: "2026-10-01T00:00:00Z",
});

describe("stand-in prompt", () => {
  it("recommends using a stand-in whose filings explain most of the fund", () => {
    render(<HoldingRow h={holding(preview(0.98))} editable />);
    expect(
      screen.getByText(/Recommended: use it for the mix/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/a retail fee, not your plan's/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use it" })).toBeInTheDocument();
  });

  it("recommends the plan's own documents when the filings explain little", () => {
    render(<HoldingRow h={holding(preview(0.4))} editable />);
    expect(screen.getByText(/only explain 40% of it/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Enter from my plan/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/404\(a\)\(5\)/)).toBeInTheDocument();
  });

  it("keeps the suggestion until the household's own figures are saved", () => {
    calls.length = 0;
    render(<HoldingRow h={holding(preview(0.4))} editable />);
    fireEvent.click(screen.getByRole("button", { name: /Enter from my plan/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(calls).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: /Enter from my plan/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(calls).toEqual(["setUserFacts", "rejectStandIn"]);
  });

  it("offers to check the stand-in's filings when they haven't been", () => {
    render(<HoldingRow h={holding(null)} editable />);
    expect(
      screen.getByRole("button", { name: "Check now" }),
    ).toBeInTheDocument();
  });
});
