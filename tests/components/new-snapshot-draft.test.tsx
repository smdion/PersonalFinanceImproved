/**
 * NewSnapshotForm — local (browser) draft: resume prompt, reconcile,
 * clear-on-save. Shipped v0.8.2.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { calendarDateOf } from "@/lib/utils/calendar-date";

const mockLatest = {
  snapshot: { id: 7, snapshotDate: "2025-01-01" },
  accounts: [
    {
      institution: "Fidelity",
      accountType: "401k",
      subType: null,
      label: null,
      taxType: "preTax",
      ownerPersonId: 1,
      amount: "100000",
      performanceAccountId: 11,
    },
  ],
};
const mockPerf = [
  {
    id: 11,
    accountLabel: "Fidelity 401k",
    displayName: null,
    accountType: "401k",
    ownerPersonId: 1,
    isActive: true,
  },
];

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./trpc-mock")).trpc,
}));
import {
  holdMutation,
  mutationCalls,
  resetTrpcMock,
  setMutationResult,
  setQuery,
  type MockOutput,
} from "./trpc-mock";

const CREATE = "networth.portfolioSnapshots.create";

const { NewSnapshotForm } =
  await import("@/components/portfolio/new-snapshot-form");

// The form defaults its date to "today" and keys the draft on it via
// calendarDateOf (LOCAL date) — use the same function here, not
// toISOString() (UTC), or the key mismatches in any timezone behind UTC
// during the evening.
const TODAY = calendarDateOf(new Date());

beforeEach(() => {
  window.localStorage.clear();
  resetTrpcMock();
  setQuery("networth.listSnapshotTotals", []);
  // A test swaps in rows built with a plain-string taxType.
  setQuery(
    "networth.portfolioSnapshots.getLatest",
    mockLatest as MockOutput<"networth.portfolioSnapshots.getLatest">,
  );
  setQuery("performance.performanceAccounts.list", mockPerf);
  setQuery("settings.people.list", [{ id: 1, name: "Alice" }]);
  setMutationResult(CREATE, { apiSyncResult: { pushed: false } });
});

describe("NewSnapshotForm fill from SimpleFIN", () => {
  it("fills linked balances and labels them", () => {
    setQuery("investments.suggestSnapshot", {
      snapshotDate: "2025-01-01",
      amounts: [{ key: "11_preTax__1", amount: 104321.5 }],
      accounts: [
        {
          performanceAccountId: 11,
          total: 104321.5,
          balanceDate: "2026-10-10",
          split: false,
          newMoney: 0,
          newMoneyEstimated: false,
        },
      ],
      unplaced: [],
    });
    render(<NewSnapshotForm onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Fill from SimpleFIN" }),
    );
    expect(screen.getByDisplayValue("104321.50")).toBeInTheDocument();
    expect(screen.getByText(/^From SimpleFIN as of/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save Snapshot" }));
    const input = mutationCalls(CREATE)[0] as {
      accounts: { amount: string }[];
    };
    expect(input.accounts[0]!.amount).toBe("104321.50");
  });
});

describe("NewSnapshotForm local draft", () => {
  it("offers to resume a saved draft and applies its amounts on resume", async () => {
    window.localStorage.setItem(
      `pf-snapshot-draft:${TODAY}`,
      JSON.stringify({
        snapshotDate: TODAY,
        notes: "half done",
        sourceSnapshotId: 7,
        savedAt: Date.now() - 60_000,
        rows: [
          {
            performanceAccountId: 11,
            institution: "Fidelity",
            accountType: "401k",
            taxType: "preTax",
            amount: "123456",
          },
        ],
      }),
    );

    render(<NewSnapshotForm onClose={() => {}} onSaved={() => {}} />);

    const resume = await screen.findByRole("button", { name: "Resume" });
    fireEvent.click(resume);

    // The reconciled row now carries the draft amount, not the prefill 100000.
    await waitFor(() =>
      expect(screen.getByDisplayValue("123456")).toBeInTheDocument(),
    );
  });

  it("restores each row of a multi-row account — not the last-typed amount everywhere", async () => {
    const row = (taxType: string, ownerPersonId: number, amount: string) => ({
      institution: "Fidelity",
      accountType: "401k",
      subType: null,
      label: null,
      taxType,
      ownerPersonId,
      amount,
      performanceAccountId: 11,
    });
    const saved = mockLatest.accounts;
    mockLatest.accounts = [
      row("preTax", 1, "100"),
      row("taxFree", 1, "200"),
      row("preTax", 2, "300"),
    ];
    try {
      window.localStorage.setItem(
        `pf-snapshot-draft:${TODAY}`,
        JSON.stringify({
          snapshotDate: TODAY,
          notes: "",
          sourceSnapshotId: 7,
          savedAt: Date.now() - 60_000,
          rows: [
            row("preTax", 1, "111"),
            row("taxFree", 1, "222"),
            row("preTax", 2, "333"),
          ],
        }),
      );
      render(<NewSnapshotForm onClose={() => {}} onSaved={() => {}} />);
      fireEvent.click(await screen.findByRole("button", { name: "Resume" }));
      await waitFor(() =>
        expect(screen.getByDisplayValue("111")).toBeInTheDocument(),
      );
      expect(screen.getByDisplayValue("222")).toBeInTheDocument();
      expect(screen.getByDisplayValue("333")).toBeInTheDocument();
    } finally {
      mockLatest.accounts = saved;
    }
  });

  it("does not offer resume when the date already has a snapshot", async () => {
    window.localStorage.setItem(
      `pf-snapshot-draft:${TODAY}`,
      JSON.stringify({
        snapshotDate: TODAY,
        notes: "",
        sourceSnapshotId: 7,
        savedAt: Date.now(),
        rows: [
          {
            performanceAccountId: 11,
            institution: "Fidelity",
            accountType: "401k",
            taxType: "preTax",
            amount: "9",
          },
        ],
      }),
    );
    // The date already has a snapshot; saving never settles.
    setQuery("networth.listSnapshotTotals", [{ id: 1, date: TODAY, total: 1 }]);
    holdMutation(CREATE);
    const mod = await import("@/components/portfolio/new-snapshot-form");
    render(<mod.NewSnapshotForm onClose={() => {}} onSaved={() => {}} />);

    await screen.findByText(/Snapshot Date/i);
    expect(
      screen.queryByRole("button", { name: "Resume" }),
    ).not.toBeInTheDocument();
  });

  it("clears the draft on a successful save", async () => {
    window.localStorage.setItem(
      `pf-snapshot-draft:${TODAY}`,
      JSON.stringify({
        snapshotDate: TODAY,
        notes: "",
        sourceSnapshotId: 7,
        savedAt: Date.now(),
        rows: [
          {
            performanceAccountId: 11,
            institution: "Fidelity",
            accountType: "401k",
            taxType: "preTax",
            amount: "5",
          },
        ],
      }),
    );
    render(<NewSnapshotForm onClose={() => {}} onSaved={() => {}} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Save Snapshot" }),
    );
    await waitFor(() => expect(mutationCalls(CREATE)).not.toHaveLength(0));
    expect(
      window.localStorage.getItem(`pf-snapshot-draft:${TODAY}`),
    ).toBeNull();
  });
});
