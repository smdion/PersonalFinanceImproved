/**
 * Holding history card: observed periods are read-only, entered ones can be
 * edited or deleted, and saving a new period sends fractions that add to 1.
 * Invented funds and accounts only.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  holdMutation,
  mutationCalls,
  resetTrpcMock,
  setQuery,
} from "./trpc-mock";

vi.mock("@/components/ui/help-tip", () => ({ HelpTip: () => null }));

const { data } = vi.hoisted(() => ({
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
        basis: "observed" as const,
        weights: { 1: 1 },
      },
      {
        id: 9,
        performanceAccountId: 3,
        subKey: null,
        orphaned: false,
        start: "2020-01-01",
        end: "2024-12-31",
        basis: "user" as const,
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
        basis: "observed" as const,
        weights: { 2: 1 },
      },
      {
        id: 12,
        performanceAccountId: 5,
        subKey: null,
        orphaned: true,
        start: "2018-01-01",
        end: "2019-12-31",
        basis: "user" as const,
        notes: null,
        weights: { 1: 1 },
      },
    ],
  },
}));

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./trpc-mock")).trpc,
}));

import { HoldingHistorySection } from "@/components/investments/holding-history-section";

const SAVE = "investments.saveHoldingPeriod";

beforeEach(() => {
  resetTrpcMock();
  setQuery("investments.listHoldingPeriods", data);
  // No write settles: the tests read what was sent.
  for (const path of [
    SAVE,
    "investments.deleteHoldingPeriod",
    "investments.addFundByTicker",
    "investments.addFundByName",
    "investments.setUserFacts",
    "investments.clearUserFacts",
  ] as const)
    holdMutation(path);
});

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
    expect(mutationCalls(SAVE)).toContainEqual(
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
    expect(mutationCalls(SAVE).at(-1)).toEqual(
      expect.objectContaining({
        performanceAccountId: 5,
        subKey: "5_taxFree__2",
        weights: [{ securityId: 2, weight: 1 }],
      }),
    );
  });
});
