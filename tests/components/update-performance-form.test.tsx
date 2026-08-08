import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UpdatePerformanceForm } from "@/components/performance/update-performance-form";
import type { AccountRow } from "@/components/performance/types";

// Smoke + behavior test for UpdatePerformanceForm.
//
// `getComputedGainLoss` (a closure inside this component wrapping the pure
// `computeGainLoss` helper) determines the value submitted to
// `batchUpdateAccounts` — it is exercised indirectly here through render +
// interaction rather than in isolation, since it isn't exported and closes
// over component state (endingBalanceSource, getEndingBalance).
//
// Expected gain/loss math (computeGainLoss = ending - beginning - totalContrib
// + distributions - rollovers + fees):
//   Account 1 (Fidelity, snapshot match @ 115000):
//     115000 - 100000 - 12000 + 0 - 0 + 50 = 3050
//   Account 2 (Vanguard, no snapshot match, manual endingBalance 50000):
//     50000 - 45000 - 6000 + 500 - 0 + 0 = -500

const batchMutate = vi.fn();
let batchMutationState: {
  isPending: boolean;
  isError: boolean;
  error: { message: string } | null;
} = {
  isPending: false,
  isError: false,
  error: null,
};

vi.mock("@/lib/trpc", () => ({
  trpc: {
    settings: {
      portfolioSnapshots: {
        getLatest: {
          useQuery: () => ({
            data: {
              snapshot: { snapshotDate: "2026-01-01" },
              accounts: [{ performanceAccountId: 101, amount: "115000" }],
            },
            isLoading: false,
          }),
        },
      },
    },
    performance: {
      batchUpdateAccounts: {
        useMutation: ({ onSuccess }: { onSuccess?: () => void }) => ({
          mutate: (input: unknown) => {
            batchMutate(input);
            onSuccess?.();
          },
          isPending: batchMutationState.isPending,
          isError: batchMutationState.isError,
          error: batchMutationState.error,
        }),
      },
    },
  },
}));

const accountRows: AccountRow[] = [
  {
    id: 1,
    institution: "Fidelity",
    accountLabel: "401(k)",
    ownerName: null,
    ownerPersonId: 1,
    ownershipType: "individual",
    beginningBalance: 100000,
    totalContributions: 12000,
    yearlyGainLoss: 2900,
    endingBalance: 105000,
    annualReturnPct: 0.03,
    employerContributions: 2000,
    fees: 50,
    distributions: 0,
    rollovers: 0,
    parentCategory: "Retirement",
    accountType: "401k",
    subType: null,
    isActive: true,
    performanceAccountId: 101,
    displayOrder: 0,
    year: 2026,
  },
  {
    id: 2,
    institution: "Vanguard",
    accountLabel: "Taxable Brokerage",
    ownerName: null,
    ownerPersonId: 1,
    ownershipType: "individual",
    beginningBalance: 45000,
    totalContributions: 6000,
    yearlyGainLoss: -400,
    endingBalance: 50000,
    annualReturnPct: -0.01,
    employerContributions: 1000,
    fees: 0,
    distributions: 500,
    rollovers: 0,
    parentCategory: "Portfolio",
    accountType: "brokerage",
    subType: null,
    isActive: true,
    performanceAccountId: 102,
    displayOrder: 0,
    year: 2026,
  },
];

describe("UpdatePerformanceForm", () => {
  beforeEach(() => {
    batchMutate.mockClear();
    batchMutationState = { isPending: false, isError: false, error: null };
  });

  it("renders without crashing and shows both account rows", () => {
    render(
      <UpdatePerformanceForm
        currentYear={2026}
        accountRows={accountRows}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.getByText("401(k)")).toBeInTheDocument();
    expect(screen.getByText("Taxable Brokerage")).toBeInTheDocument();
    expect(screen.getByText("Fidelity")).toBeInTheDocument();
    expect(screen.getByText("Vanguard")).toBeInTheDocument();
  });

  it("computes gain/loss from snapshot ending balance when a snapshot match exists", () => {
    render(
      <UpdatePerformanceForm
        currentYear={2026}
        accountRows={accountRows}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    // Account 1 has a snapshot match (115000) -> gain/loss = 3050.
    expect(screen.getByText("$3,050.00")).toBeInTheDocument();
  });

  it("falls back to the row's manual ending balance when there is no snapshot match", () => {
    render(
      <UpdatePerformanceForm
        currentYear={2026}
        accountRows={accountRows}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    // Account 2 has no snapshot match -> falls back to endingBalance (50000)
    // -> gain/loss = -500. Also flagged "(no snapshot)".
    expect(screen.getByText("-$500.00")).toBeInTheDocument();
    expect(screen.getByText("(no snapshot)")).toBeInTheDocument();
  });

  it("recomputes gain/loss for the snapshot-backed account when switching to Manual Entry", () => {
    render(
      <UpdatePerformanceForm
        currentYear={2026}
        accountRows={accountRows}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    // Baseline: snapshot-sourced gain/loss for account 1.
    expect(screen.getByText("$3,050.00")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Manual Entry"));

    // Manual mode uses row.endingBalance (105000) for account 1 instead of
    // the snapshot (115000): 105000 - 100000 - 12000 + 0 - 0 + 50 = -6950.
    expect(screen.getByText("-$6,950.00")).toBeInTheDocument();
    expect(screen.queryByText("$3,050.00")).toBeNull();
  });

  it("submits computed (non-override) gain/loss values through batchUpdateAccounts on save", () => {
    render(
      <UpdatePerformanceForm
        currentYear={2026}
        accountRows={accountRows}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save Update" }));

    expect(batchMutate).toHaveBeenCalledTimes(1);
    const { accounts } = batchMutate.mock.calls[0][0] as {
      accounts: { id: number; yearlyGainLoss: string; endingBalance: string }[];
    };
    expect(accounts).toHaveLength(2);

    const acct1 = accounts.find((a) => a.id === 1)!;
    expect(acct1.endingBalance).toBe("115000.00");
    expect(acct1.yearlyGainLoss).toBe("3050.00");

    const acct2 = accounts.find((a) => a.id === 2)!;
    expect(acct2.endingBalance).toBe("50000.00");
    expect(acct2.yearlyGainLoss).toBe("-500.00");
  });

  it("overrides the computed gain/loss with a manual value and submits that instead", () => {
    render(
      <UpdatePerformanceForm
        currentYear={2026}
        accountRows={accountRows}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    // Click the override ("edit") button next to account 1's computed
    // gain/loss — it seeds the manual field with the current computed value.
    // Both rows render this button; account 1 (Fidelity) is first.
    fireEvent.click(screen.getAllByTitle("Override with manual value")[0]);
    expect(screen.getByText("manual")).toBeInTheDocument();

    // Change the manual override input to a different value.
    const manualInput = screen
      .getAllByRole("spinbutton")
      .find((el) => (el as HTMLInputElement).value === "3050.00")!;
    fireEvent.change(manualInput, { target: { value: "9999.99" } });

    fireEvent.click(screen.getByRole("button", { name: "Save Update" }));

    const { accounts } = batchMutate.mock.calls[0][0] as {
      accounts: { id: number; yearlyGainLoss: string }[];
    };
    const acct1 = accounts.find((a) => a.id === 1)!;
    expect(acct1.yearlyGainLoss).toBe("9999.99");
  });

  it("calls onSaved after a successful save", () => {
    const onSaved = vi.fn();
    render(
      <UpdatePerformanceForm
        currentYear={2026}
        accountRows={accountRows}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save Update" }));
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Cancel is clicked", () => {
    const onClose = vi.fn();
    render(
      <UpdatePerformanceForm
        currentYear={2026}
        accountRows={accountRows}
        onClose={onClose}
        onSaved={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("filters out accounts from other years or inactive accounts", () => {
    const rows: AccountRow[] = [
      ...accountRows,
      { ...accountRows[0], id: 3, year: 2025, accountLabel: "Old Year" },
      {
        ...accountRows[0],
        id: 4,
        isActive: false,
        accountLabel: "Inactive Acct",
      },
    ];
    render(
      <UpdatePerformanceForm
        currentYear={2026}
        accountRows={rows}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.queryByText("Old Year")).toBeNull();
    expect(screen.queryByText("Inactive Acct")).toBeNull();
  });
});
