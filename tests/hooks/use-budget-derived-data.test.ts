/**
 * REGRESSION TEST for a pre-existing bug in getCatTotals.
 *
 * THE BUG. The `editMode` branch computed `getDraft(it.id, col,
 * it.amounts[col] ?? 0)` — falling back to the raw `amounts[col]` when no
 * draft exists for an item, instead of the SAME resolved value (contribution
 * -linked amount, else raw amount) the non-editMode branch uses. So a
 * contribution-linked item's category total silently changed the instant
 * edit mode turned on, before the user touched anything, because the
 * fallback skipped the contribution-linked resolution chain entirely.
 *
 * THE TEST. With no draft set for a contribution-linked item, its total must
 * be IDENTICAL whether editMode is true or false.
 */
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useBudgetDerivedData } from "@/app/(dashboard)/budget/use-budget-derived-data";
import type { RawItem } from "@/components/budget";

vi.mock("@/lib/trpc", () => ({
  trpc: {
    paycheck: {
      computeSummary: { useQuery: () => ({ data: undefined }) },
    },
  },
}));

const rawItem: RawItem = {
  id: 1,
  category: "Retirement",
  subcategory: "401k",
  amounts: [0], // raw DB amount is stale/zero — the resolved figure below is what should win
  contribAmount: 500,
  contribAmounts: [500],
  isEssential: false,
  apiCategoryId: null,
  apiCategoryName: null,
  apiSyncDirection: null,
  contributionAccountId: 42,
} as RawItem;

function setup(editMode: boolean) {
  return renderHook(() =>
    useBudgetDerivedData({
      data: {
        profile: {
          id: 1,
          columnContributionProfileIds: null,
          columnSalaryProfileIds: null,
          columnMonths: null,
        },
        columnLabels: ["Standard"],
        allColumnResults: null,
        rawItems: [rawItem],
      },
      savingsGoals: undefined,
      apiActualsData: null,
      salaryActiveFields: [],
      contributionProfileTiers: {
        planPinId: null,
        localSelectionId: null,
        globalDefaultId: null,
      },
      salaryProfileTiers: {
        planPinId: null,
        localSelectionId: null,
        globalDefaultId: null,
      },
      editMode,
      getDraft: (_id, _col, original) => original,
      visibleCount: 10,
    }),
  );
}

describe("useBudgetDerivedData — getCatTotals editMode consistency", () => {
  it("a contribution-linked item's total is the same with editMode on or off when no draft exists", () => {
    const { result: readOnly } = setup(false);
    const { result: editing } = setup(true);

    const readOnlyTotal = readOnly.current.getCatTotals([rawItem])[0];
    const editingTotal = editing.current.getCatTotals([rawItem])[0];

    expect(editingTotal).toBeCloseTo(500, 2);
    expect(editingTotal).toBeCloseTo(readOnlyTotal!, 2);
  });
});
