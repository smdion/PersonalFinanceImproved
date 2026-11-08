/**
 * Smoke test for the Savings page's budget-API dialogs (v0.10.4 commit 5b,
 * before 7 moves them onto Modal): linking a fund to an API category sends
 * savings.linkGoalToApi, and confirming a push preview runs the push
 * mutation with the fund's id.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { mutationCalls, resetTrpcMock, setQuery } from "./trpc-mock";
import { trpc } from "@/lib/trpc";
import { ApiSyncSection } from "@/components/savings/api-sync-section";

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./trpc-mock")).trpc,
}));

type Props = Parameters<typeof ApiSyncSection>[0];
type Dialogs = Pick<
  Props,
  | "linkingGoalId"
  | "setLinkingGoalId"
  | "pushPreviewItems"
  | "pendingPushGoalId"
>;

const categories = {
  groups: [
    {
      id: "g-bills",
      name: "Bills",
      categories: [
        { id: "c-rent", name: "Rent" },
        { id: "c-trip", name: "Trip fund" },
      ],
    },
  ],
};

/** The section as the Savings page renders it, its three mutations the
 *  page's own (trpc-mock records their calls). */
function Section(dialogs: Partial<Dialogs>) {
  const pushMutation = trpc.savings.pushContributionsToApi.useMutation();
  const recalculateMutation = trpc.savings.recalculateAllocation.useMutation();
  const lockInMutation = trpc.savings.lockInAllocationPercent.useMutation();
  return (
    <ApiSyncSection
      rawGoals={[]}
      apiBalanceMap={new Map()}
      apiBalancesData={{ service: "ynab", balances: [] }}
      apiCategoriesData={categories}
      canEdit
      linkingGoalId={null}
      setLinkingGoalId={vi.fn()}
      pushPreviewItems={null}
      setPushPreviewItems={vi.fn()}
      pendingPushGoalId={undefined}
      setPendingPushGoalId={vi.fn()}
      pushMutation={pushMutation}
      recalcPreviewItems={null}
      setRecalcPreviewItems={vi.fn()}
      pendingRecalcGoalId={undefined}
      setPendingRecalcGoalId={vi.fn()}
      pendingRecalcProfileId={undefined}
      setPendingRecalcProfileId={vi.fn()}
      pendingRecalcIncome={undefined}
      setPendingRecalcIncome={vi.fn()}
      recalculateMutation={recalculateMutation}
      lockInPreviewItems={null}
      setLockInPreviewItems={vi.fn()}
      pendingLockInGoalId={undefined}
      setPendingLockInGoalId={vi.fn()}
      pendingLockInProfileId={undefined}
      setPendingLockInProfileId={vi.fn()}
      pendingLockInIncome={undefined}
      setPendingLockInIncome={vi.fn()}
      lockInMutation={lockInMutation}
      {...dialogs}
    />
  );
}

describe("ApiSyncSection", () => {
  beforeEach(() => {
    resetTrpcMock();
    setQuery("sync.getActiveBudgetApi", "ynab");
  });

  it("renders nothing with no dialog open", () => {
    const { container } = render(<Section />);
    expect(container).toBeEmptyDOMElement();
  });

  it("links a fund to the chosen API category", () => {
    const setLinkingGoalId = vi.fn();
    render(<Section linkingGoalId={7} setLinkingGoalId={setLinkingGoalId} />);
    expect(screen.getByText("Link to API Category")).toBeTruthy();
    expect(screen.getByText("Bills")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Trip fund" }));
    expect(mutationCalls("savings.linkGoalToApi")).toEqual([
      {
        goalId: 7,
        service: "ynab",
        apiCategoryId: "c-trip",
        apiCategoryName: "Bills: Trip fund",
      },
    ]);
    expect(setLinkingGoalId).toHaveBeenCalledWith(null);
  });

  it("pushes a fund's contribution after the preview", () => {
    render(
      <Section
        pushPreviewItems={[
          {
            name: "Vacation",
            field: "goal_target",
            currentYnab: 250,
            newValue: 300,
          },
        ]}
        pendingPushGoalId={7}
      />,
    );
    expect(screen.getByText("Push contributions to YNAB")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Push 1 Change" }));
    expect(mutationCalls("savings.pushContributionsToApi")).toEqual([
      { goalId: 7 },
    ]);
  });
});
