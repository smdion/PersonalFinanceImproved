import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Smoke tests for src/components/debts/what-if-section.tsx — extra
// principal / one-time-payment scenario comparison table with inline
// add/edit/delete/reorder. src/components/mortgage/ had no tests prior.

vi.mock("@/components/ui/help-tip", () => ({
  HelpTip: () => null,
}));

vi.mock("@/components/ui/confirm-dialog", () => ({
  confirm: vi.fn(async () => true),
}));

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("../trpc-mock")).trpc,
}));
import { mutationCalls, resetTrpcMock } from "../trpc-mock";

import { WhatIfSection } from "@/components/debts/what-if-section";
import type {
  WhatIfResultRow,
  WhatIfScenarioRow,
} from "@/components/debts/types";

const scenarios: WhatIfScenarioRow[] = [
  {
    id: 1,
    loanId: null,
    label: "+$200/mo",
    extraMonthlyPrincipal: "200",
    extraOneTimePayment: "0",
    refinanceRate: null,
    refinanceTerm: null,
    sortOrder: 1,
  },
  {
    id: 2,
    loanId: null,
    label: "+$500/mo",
    extraMonthlyPrincipal: "500",
    extraOneTimePayment: "0",
    refinanceRate: null,
    refinanceTerm: null,
    sortOrder: 2,
  },
];

const results: WhatIfResultRow[] = [
  {
    scenarioId: 1,
    label: "+$200/mo",
    payoffDate: "2040-01-01",
    totalInterest: 80000,
    interestSaved: 20000,
    monthsSaved: 36,
  },
  {
    scenarioId: 2,
    label: "+$500/mo",
    payoffDate: "2036-01-01",
    totalInterest: 60000,
    interestSaved: 40000,
    monthsSaved: 72,
  },
];

describe("WhatIfSection smoke", () => {
  beforeEach(() => {
    resetTrpcMock();
  });

  it("renders the results table with scenario rows", () => {
    render(
      <WhatIfSection whatIfResults={results} whatIfScenarios={scenarios} />,
    );
    expect(screen.getByText("What-If Scenarios")).toBeInTheDocument();
    expect(screen.getByText("+$200/mo")).toBeInTheDocument();
    expect(screen.getByText("+$500/mo")).toBeInTheDocument();
  });

  it("shows the empty state when there are no scenarios", () => {
    render(<WhatIfSection whatIfResults={[]} whatIfScenarios={[]} />);
    expect(
      screen.getByText("No scenarios configured. Add one above."),
    ).toBeInTheDocument();
  });

  it("opens the add-scenario form and creates a scenario on Add", () => {
    render(
      <WhatIfSection whatIfResults={results} whatIfScenarios={scenarios} />,
    );
    fireEvent.click(screen.getByText("+ Add scenario"));
    fireEvent.change(screen.getByPlaceholderText("Label (e.g. +$200/mo)"), {
      target: { value: "+$1000/mo" },
    });
    fireEvent.change(screen.getByPlaceholderText("Extra $/mo"), {
      target: { value: "1000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(
      mutationCalls("mortgage.mortgageWhatIfScenarios.create"),
    ).toContainEqual(
      expect.objectContaining({
        label: "+$1000/mo",
        extraMonthlyPrincipal: "1000",
      }),
    );
  });

  it("disables the move-up button for the first scenario's row", () => {
    render(
      <WhatIfSection whatIfResults={results} whatIfScenarios={scenarios} />,
    );
    const upButtons = screen.getAllByTitle("Move up");
    expect(upButtons[0]).toBeDisabled();
  });

  it("deletes a scenario after confirming", async () => {
    render(
      <WhatIfSection whatIfResults={results} whatIfScenarios={scenarios} />,
    );
    const delButtons = screen.getAllByTitle("Delete");
    fireEvent.click(delButtons[0]!);
    await Promise.resolve();
    await Promise.resolve();
    expect(
      mutationCalls("mortgage.mortgageWhatIfScenarios.delete"),
    ).toContainEqual({ id: 1 });
  });
});
