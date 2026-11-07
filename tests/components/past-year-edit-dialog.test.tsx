import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PastYearEditDialog } from "@/components/performance/past-year-edit-dialog";
import type { AccountRow } from "@/components/performance/types";
import {
  holdMutation,
  mutationCalls,
  resetTrpcMock,
  setMutationState,
} from "./trpc-mock";

const previewData = {
  ok: true,
  preview: {
    accounts: [
      {
        id: 7,
        year: 2030,
        changes: [
          { field: "endingBalance", from: 1000, to: 925 },
          { field: "yearlyGainLoss", from: 200, to: 125 },
        ],
      },
      {
        id: 8,
        year: 2031,
        changes: [{ field: "beginningBalance", from: 1000, to: 925 }],
      },
    ],
    rollups: [
      {
        year: 2030,
        category: "Portfolio",
        changes: [{ field: "lifetimeGains", from: 700, to: 625 }],
      },
    ],
    chainable: { nextYear: 2031, rowId: 8 },
    checks: {
      7: [
        {
          kind: "snapshot",
          amount: -75,
          snapshotDate: "2030-12-31",
          snapshotBalance: 1000,
          accepted: false,
        },
      ],
    },
  },
};

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./trpc-mock")).trpc,
}));

// The dialog's two hooks (the preview, then the save) share the procedure:
// dry runs are the preview's calls.
const UPDATE = "performance.updateAccount";
const calls = () => mutationCalls(UPDATE) as { dryRun?: boolean }[];
const previewCalls = () => calls().filter((c) => c.dryRun);
const saveCalls = () => calls().filter((c) => !c.dryRun);

const account = {
  id: 7,
  year: 2030,
  institution: "Inst",
  accountLabel: "Brokerage",
  ownershipType: "individual",
  accountType: "brokerage",
} as AccountRow;

describe("PastYearEditDialog", () => {
  beforeEach(() => {
    resetTrpcMock();
    // Neither call settles; the preview's answer is already on the hook.
    holdMutation(UPDATE);
    setMutationState(UPDATE, { data: previewData });
  });

  it("previews with next year chained, lists what moves and what's left to check, then saves the same edit", () => {
    render(
      <PastYearEditDialog
        account={account}
        field="endingBalance"
        value="925"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    expect(previewCalls()).toContainEqual({
      id: 7,
      endingBalance: "925",
      chainNextYear: true,
      dryRun: true,
    });
    expect(
      screen.getByText(/2031 started at this year's old ending/),
    ).toBeTruthy();
    expect(screen.getByText(/Lifetime gains/)).toBeTruthy();
    expect(
      screen.getByText(/Ending is \$75\.00 below the 2030-12-31 snapshot/),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox"));
    expect(previewCalls().at(-1)).toEqual(
      expect.objectContaining({ chainNextYear: false, dryRun: true }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Save change" }));
    expect(saveCalls()).toContainEqual({
      id: 7,
      endingBalance: "925",
      chainNextYear: false,
    });
  });
});
