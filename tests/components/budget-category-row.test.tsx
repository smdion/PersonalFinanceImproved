/**
 * Regression test for the Budget page's "PC" badge showing a linked item's
 * fuzzy name-matched neighbor's dollar figure instead of its own.
 *
 * THE BUG (reported directly against real dev data). "R Brokerage" and "LT
 * Brokerage" are two DIFFERENT contribution accounts that both normalize to
 * the canonical keyword "brokerage". R Brokerage is linked
 * (contributionAccountId set) with its own real amount ($0/mo, inactive);
 * LT Brokerage is linked separately with $950/mo. Before this fix, the "PC"
 * badge for BOTH items was driven by matchContrib(item.subcategory) alone —
 * a fuzzy, name-keyed lookup blind to which account is actually linked to
 * which item — so R Brokerage's badge/tooltip showed LT Brokerage's $950,
 * confidently claiming "editing here updates it everywhere" for a number
 * that had nothing to do with R Brokerage's real linked account.
 *
 * THE FIX. A linked item (contributionAccountId != null) must always use
 * its OWN resolved amount (contribAmounts[col] / contribAmount) for the
 * badge, never the fuzzy match. Only a genuinely unlinked item falls back
 * to the fuzzy estimate.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BudgetCategoryRow } from "@/components/budget/budget-category-row";
import type { RawItem } from "@/components/budget";

const noop = () => {};

function renderRow(
  items: RawItem[],
  matchContrib: (subcategory: string, colIdx?: number) => number | null,
) {
  return render(
    <table>
      <tbody>
        <BudgetCategoryRow
          categoryName="Investments"
          items={items}
          numCols={1}
          catTotals={[0]}
          editMode={false}
          getDraft={(_id, _col, original) => original}
          onSetDraft={noop}
          onToggleItemEssential={noop}
          onToggleCategoryEssential={noop}
          onMoveItem={noop}
          onDeleteItem={noop}
          onReorderItem={noop}
          onReorderCategory={noop}
          isFirstCategory
          isLastCategory
          onAddItem={noop}
          addItemPending={false}
          addItemError={null}
          categoryNames={["Investments"]}
          addingItemToCategory={null}
          onSetAddingItemToCategory={noop}
          matchContrib={matchContrib}
          activeColumn={0}
        />
      </tbody>
    </table>,
  );
}

function makeItem(overrides: Partial<RawItem>): RawItem {
  return {
    id: 1,
    category: "Investments",
    subcategory: "Item",
    amounts: [0],
    isEssential: false,
    apiCategoryId: null,
    apiCategoryName: null,
    apiSyncDirection: null,
    contributionAccountId: null,
    ...overrides,
  } as RawItem;
}

describe("BudgetCategoryRow — linked items use their own amount, not the fuzzy match", () => {
  it("R Brokerage (linked, $0) does not borrow LT Brokerage's fuzzy-matched $950", () => {
    const rBrokerage = makeItem({
      id: 1,
      subcategory: "R Brokerage",
      contributionAccountId: 12,
      contribAmount: 0,
      contribAmounts: [0],
    });
    const ltBrokerage = makeItem({
      id: 2,
      subcategory: "LT Brokerage",
      contributionAccountId: 3,
      contribAmount: 950,
      contribAmounts: [950],
    });
    // Simulates the real-world keyword collision: both subcategories
    // normalize to "brokerage", so a naive fuzzy lookup would return the
    // SAME figure for both regardless of which account is really linked.
    const matchContrib = vi.fn().mockReturnValue(950);

    renderRow([rBrokerage, ltBrokerage], matchContrib);

    const badges = screen.getAllByText("PC");
    expect(badges).toHaveLength(2);
    expect(badges[0]!.title).toContain("$0.00");
    expect(badges[0]!.title).not.toContain("$950");
    expect(badges[1]!.title).toContain("$950.00");
  });

  it("an unlinked item still shows the fuzzy-matched estimate", () => {
    const unlinked = makeItem({
      id: 3,
      subcategory: "Health Savings",
      contributionAccountId: null,
    });
    const matchContrib = vi.fn().mockReturnValue(200);

    renderRow([unlinked], matchContrib);

    const badge = screen.getByText("PC");
    expect(badge.title).toContain("$200.00");
    expect(badge.title).toContain("Values are independent");
    expect(matchContrib).toHaveBeenCalledWith("Health Savings", 0);
  });

  it("passes the active column through to matchContrib instead of always using column 0", () => {
    const unlinked = makeItem({
      id: 4,
      subcategory: "Misc",
      contributionAccountId: null,
    });
    const matchContrib = vi.fn().mockReturnValue(null);

    render(
      <table>
        <tbody>
          <BudgetCategoryRow
            categoryName="Investments"
            items={[unlinked]}
            numCols={3}
            catTotals={[0, 0, 0]}
            editMode={false}
            getDraft={(_id, _col, original) => original}
            onSetDraft={noop}
            onToggleItemEssential={noop}
            onToggleCategoryEssential={noop}
            onMoveItem={noop}
            onDeleteItem={noop}
            onReorderItem={noop}
            onReorderCategory={noop}
            isFirstCategory
            isLastCategory
            onAddItem={noop}
            addItemPending={false}
            addItemError={null}
            categoryNames={["Investments"]}
            addingItemToCategory={null}
            onSetAddingItemToCategory={noop}
            matchContrib={matchContrib}
            activeColumn={2}
          />
        </tbody>
      </table>,
    );

    expect(matchContrib).toHaveBeenCalledWith("Misc", 2);
  });
});

/**
 * Regression coverage for explaining WHY a linked item's amount is $0 for
 * the column being viewed, instead of a bare "PC" badge that reads as a
 * confidently-correct $0. Also covers that the reason is read per-column
 * (item.contribStatus[activeColumn]), not flattened across all columns.
 */
describe("BudgetCategoryRow — contribStatus badge for linked items", () => {
  function renderTwoColumnRow(item: RawItem, activeColumn: number) {
    return render(
      <table>
        <tbody>
          <BudgetCategoryRow
            categoryName="Investments"
            items={[item]}
            numCols={2}
            catTotals={[0, 0]}
            editMode={false}
            getDraft={(_id, _col, original) => original}
            onSetDraft={noop}
            onToggleItemEssential={noop}
            onToggleCategoryEssential={noop}
            onMoveItem={noop}
            onDeleteItem={noop}
            onReorderItem={noop}
            onReorderCategory={noop}
            isFirstCategory
            isLastCategory
            onAddItem={noop}
            addItemPending={false}
            addItemError={null}
            categoryNames={["Investments"]}
            addingItemToCategory={null}
            onSetAddingItemToCategory={noop}
            matchContrib={() => null}
            activeColumn={activeColumn}
          />
        </tbody>
      </table>,
    );
  }

  it("shows the normal indigo PC badge when contribStatus is ok", () => {
    const item = makeItem({
      subcategory: "LT Brokerage",
      contributionAccountId: 3,
      contribAmounts: [950, 950],
      contribStatus: ["ok", "ok"],
    });

    renderTwoColumnRow(item, 0);

    const badge = screen.getByText("PC");
    expect(badge.title).toContain("$950.00");
  });

  it("shows a distinct amber badge with the right copy for inactive_in_profile", () => {
    const item = makeItem({
      subcategory: "R Brokerage",
      contributionAccountId: 12,
      contribAmounts: [0, 0],
      contribStatus: ["inactive_in_profile", "inactive_in_profile"],
    });

    renderTwoColumnRow(item, 0);

    expect(screen.queryByText("PC")).toBeNull();
    const badge = screen.getByText("Off");
    expect(badge.title).toContain(
      "Turned off in this column's Contribution Profile",
    );
  });

  it("shows a distinct amber badge with the right copy for not_in_profile", () => {
    const item = makeItem({
      subcategory: "R Brokerage",
      contributionAccountId: 12,
      contribAmounts: [0, 0],
      contribStatus: ["not_in_profile", "not_in_profile"],
    });

    renderTwoColumnRow(item, 0);

    const badge = screen.getByText("Not Set");
    expect(badge.title).toContain("has no value set for this account");
  });

  it("reads the status for the ACTIVE column, not a flattened value across all columns", () => {
    const item = makeItem({
      subcategory: "R Brokerage",
      contributionAccountId: 12,
      contribAmounts: [950, 0],
      contribStatus: ["ok", "inactive_in_profile"],
    });

    const { rerender } = renderTwoColumnRow(item, 0);
    expect(screen.getByText("PC").title).toContain("$950.00");

    rerender(
      <table>
        <tbody>
          <BudgetCategoryRow
            categoryName="Investments"
            items={[item]}
            numCols={2}
            catTotals={[0, 0]}
            editMode={false}
            getDraft={(_id, _col, original) => original}
            onSetDraft={noop}
            onToggleItemEssential={noop}
            onToggleCategoryEssential={noop}
            onMoveItem={noop}
            onDeleteItem={noop}
            onReorderItem={noop}
            onReorderCategory={noop}
            isFirstCategory
            isLastCategory
            onAddItem={noop}
            addItemPending={false}
            addItemError={null}
            categoryNames={["Investments"]}
            addingItemToCategory={null}
            onSetAddingItemToCategory={noop}
            matchContrib={() => null}
            activeColumn={1}
          />
        </tbody>
      </table>,
    );
    expect(screen.queryByText("PC")).toBeNull();
    expect(screen.getByText("Off")).toBeTruthy();
  });
});
