import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CoastFireCard } from "@/components/cards/coast-fire-card";

// Smoke test for CoastFireCard — covers its distinct deterministic-status
// render branches (no data / unreachable / already_coast / found) plus the
// combined baseline+simulated branch that activates once the shared Coast
// FIRE Monte Carlo result is available.

const mockUseQuery = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    projection: {
      computeCoastFire: {
        useQuery: (...args: unknown[]) => mockUseQuery(...args),
      },
    },
  },
}));

// KpiCard always renders a HelpTip for its tooltip prop, which needs a Radix
// TooltipProvider ancestor CoastFireCard doesn't supply on its own (normally
// mounted under the page's provider tree). Stub it out like other tests do.
vi.mock("@/components/ui/help-tip", () => ({ HelpTip: () => null }));

// decumulationDefaults/accumulationOverrides/decumulationOverrides all have
// zod `.default(...)` on the router input schema, so an empty object with
// just snapshotId is a valid CoastFireInput without needing a cast.
const baseInput: Parameters<typeof CoastFireCard>[0]["input"] = {
  snapshotId: 1,
};

function setDeterministic(result: unknown) {
  mockUseQuery.mockReturnValue({ data: result ? { result } : undefined });
}

describe("CoastFireCard", () => {
  it("renders a placeholder dash while deterministic data is loading", () => {
    setDeterministic(null);
    render(<CoastFireCard input={baseInput} />);
    expect(screen.getByText("Coast FIRE")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders 'Not reachable' when deterministic status is unreachable", () => {
    setDeterministic({
      coastFireAge: null,
      status: "unreachable",
      sustainableWithdrawalToday: 0,
      projectedExpensesAtRetirementToday: 0,
    });
    render(<CoastFireCard input={baseInput} />);
    expect(screen.getByText("Not reachable")).toBeInTheDocument();
  });

  it("renders 'Already ✓' when deterministic status is already_coast", () => {
    setDeterministic({
      coastFireAge: null,
      status: "already_coast",
      sustainableWithdrawalToday: 60000,
      projectedExpensesAtRetirementToday: 50000,
    });
    render(<CoastFireCard input={baseInput} />);
    expect(screen.getByText("Already ✓")).toBeInTheDocument();
    expect(screen.getByText(/60,000/)).toBeInTheDocument();
  });

  it("renders the found age when deterministic status is found", () => {
    setDeterministic({
      coastFireAge: 52,
      status: "found",
      sustainableWithdrawalToday: 40000,
      projectedExpensesAtRetirementToday: 45000,
    });
    render(<CoastFireCard input={baseInput} />);
    expect(screen.getByText("Age 52")).toBeInTheDocument();
  });

  it("renders the combined baseline+simulated status once the MC result is available", () => {
    setDeterministic({
      coastFireAge: 52,
      status: "found",
      sustainableWithdrawalToday: 40000,
      projectedExpensesAtRetirementToday: 45000,
    });
    render(
      <CoastFireCard
        input={baseInput}
        coastFireMcResult={{
          coastFireAge: 55,
          status: "found",
          successRate: 0.92,
          stopNowSuccessRate: 0.6,
          spendingStabilityRate: 0.8,
          confidenceThreshold: 0.9,
          warning: null,
        }}
      />,
    );
    // Both "found" -> shows the more conservative (later) age (55).
    expect(screen.getByText("Age 55")).toBeInTheDocument();
    // Simulated detail line renders the stop-now success rate.
    expect(screen.getByText(/60% simulated/)).toBeInTheDocument();
  });

  it("shows the loading indicator while the MC result is still fetching", () => {
    setDeterministic({
      coastFireAge: 52,
      status: "found",
      sustainableWithdrawalToday: 40000,
      projectedExpensesAtRetirementToday: 45000,
    });
    render(
      <CoastFireCard
        input={baseInput}
        coastFireMcLoading
        coastFireMcResult={undefined}
      />,
    );
    expect(screen.getByText("Running simulations...")).toBeInTheDocument();
  });
});
