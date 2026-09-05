/**
 * NewSnapshotForm — local (browser) draft: resume prompt, reconcile,
 * clear-on-save. Feature B of SNAPSHOT-BALANCE-EDIT-AND-DRAFT.md.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const createMutate = vi.fn();
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

vi.mock("@/lib/trpc", () => ({
  trpc: {
    networth: {
      listSnapshotTotals: { useQuery: () => ({ data: [] }) },
      portfolioSnapshots: {
        getLatest: { useQuery: () => ({ data: mockLatest, isLoading: false }) },
        create: {
          useMutation: (opts: { onSuccess?: (d: unknown) => void }) => ({
            mutate: (...a: unknown[]) => {
              createMutate(...a);
              opts.onSuccess?.({ apiSyncResult: { pushed: false } });
            },
            isPending: false,
            isError: false,
            error: null,
          }),
        },
      },
    },
    performance: {
      performanceAccounts: {
        list: { useQuery: () => ({ data: mockPerf, isLoading: false }) },
      },
    },
    settings: {
      people: {
        list: {
          useQuery: () => ({
            data: [{ id: 1, name: "Alice" }],
            isLoading: false,
          }),
        },
      },
    },
  },
}));

const { NewSnapshotForm } =
  await import("@/components/portfolio/new-snapshot-form");

// The form defaults its date to "today" — pin it so the draft key matches.
const TODAY = new Date().toISOString().slice(0, 10);

beforeEach(() => {
  window.localStorage.clear();
  createMutate.mockClear();
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
    // Re-mock listSnapshotTotals to report the date as taken.
    vi.resetModules();
    vi.doMock("@/lib/trpc", () => ({
      trpc: {
        networth: {
          listSnapshotTotals: {
            useQuery: () => ({ data: [{ id: 1, date: TODAY, total: 1 }] }),
          },
          portfolioSnapshots: {
            getLatest: {
              useQuery: () => ({ data: mockLatest, isLoading: false }),
            },
            create: {
              useMutation: () => ({
                mutate: vi.fn(),
                isPending: false,
                isError: false,
                error: null,
              }),
            },
          },
        },
        performance: {
          performanceAccounts: {
            list: { useQuery: () => ({ data: mockPerf, isLoading: false }) },
          },
        },
        settings: {
          people: {
            list: {
              useQuery: () => ({
                data: [{ id: 1, name: "Alice" }],
                isLoading: false,
              }),
            },
          },
        },
      },
    }));
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
    await waitFor(() => expect(createMutate).toHaveBeenCalled());
    expect(
      window.localStorage.getItem(`pf-snapshot-draft:${TODAY}`),
    ).toBeNull();
  });
});
