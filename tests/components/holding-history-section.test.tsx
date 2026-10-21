/**
 * Holding history card: observed periods are read-only, entered ones can be
 * edited or deleted, and saving a new period sends fractions that add to 1.
 * Invented funds and accounts only.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/components/ui/help-tip", () => ({ HelpTip: () => null }));

const { data, save } = vi.hoisted(() => ({
  save: vi.fn(),
  data: {
    accounts: [
      { id: 3, label: "Example IRA", split: false, conflict: false },
      { id: 5, label: "Example Joint IRA", split: true, conflict: false },
    ],
    holders: [
      { performanceAccountId: 3, subKey: null, label: "Example IRA" },
      { performanceAccountId: 5, subKey: "5_taxFree__1", label: "Alex — Roth" },
      { performanceAccountId: 5, subKey: "5_taxFree__2", label: "Sam — Roth" },
    ],
    funds: [
      { id: 1, label: "EXSTX — Example Stock", inPeriods: true, facts: null },
      {
        id: 2,
        label: "Example Plan Fund",
        inPeriods: true,
        facts: { expenseRatio: null, composition: null, stale: false },
      },
    ],
    periods: [
      {
        id: null,
        performanceAccountId: 3,
        subKey: null,
        orphaned: false,
        start: "2026-10-12",
        end: null,
        basis: "observed",
        weights: { 1: 1 },
      },
      {
        id: 9,
        performanceAccountId: 3,
        subKey: null,
        orphaned: false,
        start: "2020-01-01",
        end: "2024-12-31",
        basis: "user",
        notes: null,
        weights: { 1: 0.6, 2: 0.4 },
      },
      {
        id: null,
        performanceAccountId: 5,
        subKey: "5_taxFree__2",
        orphaned: false,
        start: "2026-10-12",
        end: null,
        basis: "observed",
        weights: { 2: 1 },
      },
      {
        id: 12,
        performanceAccountId: 5,
        subKey: null,
        orphaned: true,
        start: "2018-01-01",
        end: "2019-12-31",
        basis: "user",
        notes: null,
        weights: { 1: 1 },
      },
    ],
  },
}));

vi.mock("@/lib/trpc", () => {
  const mutation = (fn = vi.fn()) => ({
    useMutation: () => ({
      mutate: fn,
      isPending: false,
      isError: false,
      error: null,
    }),
  });
  return {
    trpc: {
      useUtils: () => ({ investments: { invalidate: vi.fn() } }),
      investments: {
        listHoldingPeriods: { useQuery: () => ({ data }) },
        saveHoldingPeriod: mutation(save),
        deleteHoldingPeriod: mutation(),
        addFundByTicker: mutation(),
        addFundByName: mutation(),
        setUserFacts: mutation(),
        clearUserFacts: mutation(),
      },
    },
  };
});

import { HoldingHistorySection } from "@/components/investments/holding-history-section";

describe("HoldingHistorySection", () => {
  it("observed periods are read-only; entered ones can be edited; unknown mixes are flagged", () => {
    render(<HoldingHistorySection />);
    expect(screen.getByText("From daily holdings")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(1);
    expect(screen.getByText(/mix unknown/)).toBeInTheDocument();
  });

  it("adds a period: picks a fund, sends fractions", () => {
    render(<HoldingHistorySection />);
    fireEvent.click(screen.getByRole("button", { name: "Add a period" }));
    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "2016-01-01" },
    });
    fireEvent.change(screen.getByDisplayValue("Pick a fund…"), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText("Share of the account"), {
      target: { value: "100" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save period" }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: null,
        performanceAccountId: 3,
        subKey: null,
        start: "2016-01-01",
        end: null,
        weights: [{ securityId: 1, weight: 1 }],
      }),
    );
  });

  it("an account reported per part: picks a part, saves to it, and shows a misplaced period to move", () => {
    render(<HoldingHistorySection />);
    fireEvent.change(screen.getByDisplayValue("Example IRA"), {
      target: { value: "5|5_taxFree__2" },
    });
    // Sam's part: only its own period, none of the account's other parts.
    expect(screen.getAllByText("From daily holdings")).toHaveLength(1);
    expect(screen.getByText(/no longer has/)).toBeInTheDocument();
    expect(screen.getByLabelText("Move this period to")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add a period" }));
    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "2016-01-01" },
    });
    fireEvent.change(screen.getByDisplayValue("Pick a fund…"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText("Share of this part"), {
      target: { value: "100" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save period" }));
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        performanceAccountId: 5,
        subKey: "5_taxFree__2",
        weights: [{ securityId: 2, weight: 1 }],
      }),
    );
  });
});
