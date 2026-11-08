/**
 * The integrations preview panel's writes, one per section: each control
 * sends the same procedure with the same input, and every write invalidates
 * the preview and nothing else. Pins the plumbing between the panel, its
 * five sections and their mutation hooks, so moving where a hook is called
 * can't change what is sent or refetched.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  mutationCalls,
  resetTrpcMock,
  setMutationResult,
  setQuery,
  utilsCalledPaths,
  utilsCalls,
} from "./trpc-mock";
import type { PreviewData } from "@/components/settings/integrations-types";

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./trpc-mock")).trpc,
}));

import { PreviewPanel } from "@/components/settings/integrations-preview-panel";

const apiCat = (id: string, name: string, groupName: string) => ({
  id,
  name,
  groupName,
  budgeted: 0,
});

const budgetMatch = {
  ledgrAmount: 100,
  apiBudgeted: null,
  apiActivity: null,
  syncDirection: null,
  contributionAccountId: null,
} as const;

/** An invented household: one suggested and one unmatched budget item, a
 *  drifted linked item tied to a contribution account, one suggested and
 *  one unmatched savings goal, an API-only category and an unmapped
 *  tracking account. */
function makePreview(): PreviewData {
  return {
    synced: true,
    fetchedAt: "2026-06-01T12:00:00.000Z",
    lastSyncedAt: null,
    cash: { manual: 0, api: 0, apiAccounts: [] },
    accounts: { total: 0, onBudget: 0, tracking: 0, byType: {} },
    categories: { groups: 3, total: 5 },
    apiCategories: [
      apiCat("cat-groceries", "Groceries", "Everyday"),
      apiCat("cat-roof", "Roof", "Goals"),
      apiCat("cat-401k", "401k", "Savings"),
      apiCat("cat-gym", "Gym", "Health"),
    ],
    profile: {
      linkedProfileId: 1,
      linkedProfileName: "Main",
      linkedColumnIndex: 0,
      columnLabels: ["Standard", "Lean"],
      availableProfiles: [
        { id: 1, name: "Main", isActive: true, columnLabels: ["Standard"] },
        { id: 2, name: "Spare", isActive: false, columnLabels: ["Standard"] },
      ],
    },
    portfolio: {
      snapshotDate: "2026-06-01",
      localAccounts: [
        {
          label: "Jordan IRA",
          balance: 50000,
          performanceAccountId: 5,
          ownerPersonId: 1,
        },
      ],
      assetAccounts: [],
      mortgageAccounts: [],
      debtAccounts: [],
      trackingAccounts: [
        { id: "remote-1", name: "Remote IRA", balance: 50000, type: "other" },
      ],
      allAccounts: [],
      existingMappings: [],
    },
    budget: {
      matches: [
        {
          ...budgetMatch,
          budgetItemId: 10,
          ledgrName: "Groceries",
          ledgrCategory: "Food",
          status: "suggested",
          apiCategoryId: "cat-groceries",
          apiCategoryName: "Groceries",
          apiGroupName: "Everyday",
        },
        {
          ...budgetMatch,
          budgetItemId: 11,
          ledgrName: "Rent",
          ledgrCategory: "Housing",
          status: "unmatched",
          apiCategoryId: null,
          apiCategoryName: null,
          apiGroupName: null,
        },
        {
          ...budgetMatch,
          budgetItemId: 12,
          ledgrName: "Retirement",
          ledgrCategory: "Savings",
          status: "linked",
          apiCategoryId: "cat-401k",
          apiCategoryName: "401k",
          apiGroupName: "Savings",
          syncDirection: "pull",
          nameDrifted: true,
          categoryDrifted: false,
          contributionAccountId: 7,
        },
      ],
      unmatchedApiCategories: [apiCat("cat-gym", "Gym", "Health")],
      skippedApiCategories: [],
      summary: {
        linked: 1,
        suggested: 1,
        unmatched: 1,
        orphaned: 0,
        apiOnly: 1,
      },
    },
    savings: {
      matches: [
        {
          goalId: 20,
          goalName: "Roof",
          status: "suggested",
          apiCategoryId: "cat-roof",
          apiCategoryName: "Roof",
          apiBalance: null,
          nameDrifted: false,
          isEmergencyFund: false,
          reimbursementApiCategoryId: null,
        },
        {
          goalId: 21,
          goalName: "Vacation",
          status: "unmatched",
          apiCategoryId: null,
          apiCategoryName: null,
          apiBalance: null,
          nameDrifted: false,
          isEmergencyFund: false,
          reimbursementApiCategoryId: null,
        },
      ],
      summary: { linked: 0, suggested: 1, unmatched: 1, orphaned: 0 },
    },
  };
}

function renderPanel() {
  render(
    <PreviewPanel preview={makePreview()} isActive={true} service="ynab" />,
  );
}

/** Every write so far invalidated the preview once, and nothing else. */
function expectOnlyPreviewInvalidated(writes: number) {
  expect(utilsCalledPaths()).toEqual(["sync.getPreview.invalidate"]);
  expect(utilsCalls("sync.getPreview.invalidate")).toHaveLength(writes);
}

async function settle() {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

beforeEach(() => {
  resetTrpcMock();
  setQuery("budget.listContribAccountsForLinking", [
    { id: 7, displayLabel: "Jordan 401k" },
    { id: 8, displayLabel: "Jordan HSA" },
  ]);
});

describe("PreviewPanel — drift banner writes", () => {
  it("'Use all API names' pulls every name", () => {
    renderPanel();
    fireEvent.click(screen.getByText("Use all API names"));
    expect(mutationCalls("sync.syncAllNames")).toEqual([
      { service: "ynab", direction: "pull" },
    ]);
    expectOnlyPreviewInvalidated(1);
  });

  it("the profile and mode pickers set the linked profile and column", () => {
    renderPanel();
    fireEvent.change(screen.getByDisplayValue("Main (active)"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByDisplayValue("Standard"), {
      target: { value: "1" },
    });
    expect(mutationCalls("sync.setLinkedProfile")).toEqual([
      { service: "ynab", profileId: 2 },
    ]);
    expect(mutationCalls("sync.setLinkedColumn")).toEqual([
      { service: "ynab", columnIndex: 1 },
    ]);
    expectOnlyPreviewInvalidated(2);
  });
});

describe("PreviewPanel — budget section writes", () => {
  it("'Apply all suggested matches' links the suggested item", () => {
    renderPanel();
    fireEvent.click(screen.getByText("Apply all suggested matches (2)"));
    expect(mutationCalls("budget.linkToApi")).toEqual([
      {
        budgetItemId: 10,
        service: "ynab",
        apiCategoryId: "cat-groceries",
        apiCategoryName: "Groceries",
        syncDirection: "pull",
      },
    ]);
    expectOnlyPreviewInvalidated(1);
  });

  it("'Skip' skips the API-only category", () => {
    renderPanel();
    fireEvent.click(screen.getByText("Skip"));
    expect(mutationCalls("sync.skipCategory")).toEqual([
      { service: "ynab", categoryId: "cat-gym" },
    ]);
    expectOnlyPreviewInvalidated(1);
  });

  it("'+ Budget item' creates the item, then links it", async () => {
    setMutationResult("budget.createItem", { id: 99 });
    renderPanel();
    await act(async () => {
      fireEvent.click(screen.getByText("+ Budget item"));
      await settle();
    });
    expect(mutationCalls("budget.createItem")).toEqual([
      { category: "Health", subcategory: "Gym" },
    ]);
    expect(mutationCalls("budget.linkToApi")).toEqual([
      {
        budgetItemId: 99,
        service: "ynab",
        apiCategoryId: "cat-gym",
        apiCategoryName: "Gym",
        syncDirection: "pull",
      },
    ]);
    expectOnlyPreviewInvalidated(2);
  });

  it("'+ Sinking fund' creates a goal through the savings hook, then links it", async () => {
    setMutationResult("savings.savingsGoals.create", { id: 77 });
    renderPanel();
    await act(async () => {
      fireEvent.click(screen.getByText("+ Sinking fund"));
      await settle();
    });
    expect(mutationCalls("savings.savingsGoals.create")).toEqual([
      { name: "Gym", targetMode: "ongoing", isActive: true },
    ]);
    expect(mutationCalls("savings.linkGoalToApi")).toEqual([
      {
        goalId: 77,
        service: "ynab",
        apiCategoryId: "cat-gym",
        apiCategoryName: "Gym",
      },
    ]);
    expectOnlyPreviewInvalidated(2);
  });

  it("linking an API-only category to an existing goal goes through the savings hook", () => {
    renderPanel();
    const budgetPicker = screen
      .getAllByDisplayValue("Link to existing...")
      .find((s) => s.textContent?.includes("Vacation"))!;
    fireEvent.change(budgetPicker, { target: { value: "savings:21" } });
    // The budget section's Link button sits next to its picker.
    const picker = screen.getByDisplayValue("Vacation");
    fireEvent.click(picker.parentElement!.querySelector("button")!);
    expect(mutationCalls("savings.linkGoalToApi")).toEqual([
      {
        goalId: 21,
        service: "ynab",
        apiCategoryId: "cat-gym",
        apiCategoryName: "Gym",
      },
    ]);
    expect(mutationCalls("budget.linkToApi")).toEqual([]);
    expectOnlyPreviewInvalidated(1);
  });
});

describe("PreviewPanel — savings section writes", () => {
  it("'Apply all suggested matches' links the suggested goal", () => {
    renderPanel();
    fireEvent.click(screen.getByText("Apply all suggested matches"));
    expect(mutationCalls("savings.linkGoalToApi")).toEqual([
      {
        goalId: 20,
        service: "ynab",
        apiCategoryId: "cat-roof",
        apiCategoryName: "Roof",
      },
    ]);
    expectOnlyPreviewInvalidated(1);
  });
});

describe("PreviewPanel — contribution section writes", () => {
  it("links an unlinked account and unlinks a linked item", () => {
    renderPanel();
    fireEvent.change(screen.getByDisplayValue("Select budget item..."), {
      target: { value: "11" },
    });
    fireEvent.click(screen.getByTitle("Unlink contribution account"));
    expect(mutationCalls("budget.linkContributionAccount")).toEqual([
      { budgetItemId: 11, contributionAccountId: 8 },
    ]);
    expect(mutationCalls("budget.unlinkContributionAccount")).toEqual([
      { budgetItemId: 12 },
    ]);
    expectOnlyPreviewInvalidated(2);
  });
});

describe("PreviewPanel — portfolio section writes", () => {
  it("'+ Create Asset' maps the tracking account to a new asset", () => {
    renderPanel();
    fireEvent.click(screen.getByText("+ Create Asset"));
    expect(mutationCalls("sync.createAssetAndMap")).toEqual([
      {
        service: "ynab",
        assetName: "Remote IRA",
        balance: 50000,
        remoteAccountId: "remote-1",
        syncDirection: "pull",
      },
    ]);
    expectOnlyPreviewInvalidated(1);
  });

  it("linking to an existing account saves the mapping", () => {
    renderPanel();
    const select = screen
      .getAllByDisplayValue("Link to existing...")
      .find((s) => s.textContent?.includes("Jordan IRA"))!;
    fireEvent.change(select, {
      target: { value: "performance:5|Jordan IRA" },
    });
    expect(mutationCalls("sync.updateAccountMappings")).toEqual([
      {
        service: "ynab",
        mappings: [
          {
            localId: "performance:5",
            localName: "Jordan IRA",
            remoteAccountId: "remote-1",
            syncDirection: "push",
            performanceAccountId: 5,
          },
        ],
      },
    ]);
    expectOnlyPreviewInvalidated(1);
  });
});
