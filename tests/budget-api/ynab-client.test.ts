import { describe, it, expect, vi, beforeEach } from "vitest";
import { YnabClient, YNAB_INTERNAL_GROUPS } from "@/lib/budget-api/ynab-client";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(data: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

describe("YnabClient", () => {
  let client: YnabClient;

  beforeEach(() => {
    mockFetch.mockReset();
    client = new YnabClient("test-token", "test-budget-id");
  });

  it("supports delta sync", () => {
    expect(client.supportsDeltaSync).toBe(true);
  });

  describe("testConnection", () => {
    it("returns true on success", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ data: { settings: {} } }));
      expect(await client.testConnection()).toBe(true);
    });

    it("returns false on failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));
      expect(await client.testConnection()).toBe(false);
    });
  });

  describe("getBudgetName", () => {
    it("returns matching budget name", async () => {
      mockFetch.mockReturnValueOnce(
        jsonResponse({
          data: {
            budgets: [
              { id: "other-id", name: "Other" },
              { id: "test-budget-id", name: "My Budget" },
            ],
          },
        }),
      );
      expect(await client.getBudgetName()).toBe("My Budget");
    });

    it("returns 'Unknown Budget' when not found", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ data: { budgets: [] } }));
      expect(await client.getBudgetName()).toBe("Unknown Budget");
    });
  });

  describe("getAccounts", () => {
    it("maps YNAB accounts to BudgetAccount format", async () => {
      mockFetch.mockReturnValueOnce(
        jsonResponse({
          data: {
            accounts: [
              {
                id: "acct-1",
                name: "Checking",
                type: "checking",
                on_budget: true,
                closed: false,
                balance: 150000, // milliunits = $150
                cleared_balance: 140000,
                transfer_payee_id: "tp-1",
              },
            ],
          },
        }),
      );
      const accounts = await client.getAccounts();
      expect(accounts).toHaveLength(1);
      expect(accounts[0]).toMatchObject({
        id: "acct-1",
        name: "Checking",
        type: "checking",
        onBudget: true,
        closed: false,
        balance: 150,
        clearedBalance: 140,
      });
    });
  });

  describe("getAccountBalance", () => {
    it("returns balance in dollars", async () => {
      mockFetch.mockReturnValueOnce(
        jsonResponse({ data: { account: { balance: 50000 } } }),
      );
      expect(await client.getAccountBalance("acct-1")).toBe(50);
    });
  });

  describe("getCategories", () => {
    it("filters out internal YNAB groups", async () => {
      mockFetch.mockReturnValueOnce(
        jsonResponse({
          data: {
            category_groups: [
              {
                id: "g1",
                name: "Bills",
                hidden: false,
                categories: [
                  {
                    id: "c1",
                    name: "Rent",
                    category_group_id: "g1",
                    hidden: false,
                    budgeted: 1500000,
                    activity: -1500000,
                    balance: 0,
                    goal_target: null,
                    goal_type: null,
                    note: null,
                  },
                ],
              },
              {
                id: "g-internal",
                name: "Internal Master Category",
                hidden: true,
                categories: [],
              },
            ],
          },
        }),
      );
      const groups = await client.getCategories();
      expect(groups).toHaveLength(1);
      expect(groups[0].name).toBe("Bills");
    });
  });

  describe("getTransactions", () => {
    it("maps transactions with cleared status", async () => {
      mockFetch.mockReturnValueOnce(
        jsonResponse({
          data: {
            transactions: [
              {
                id: "tx-1",
                account_id: "acct-1",
                account_name: "Checking",
                date: "2026-01-15",
                amount: -25000,
                payee_name: "Grocery Store",
                category_id: "cat-1",
                category_name: "Food",
                memo: "Weekly groceries",
                cleared: "cleared",
                approved: true,
                deleted: false,
              },
              {
                id: "tx-2",
                account_id: "acct-1",
                account_name: "Checking",
                date: "2026-01-16",
                amount: -10000,
                payee_name: null,
                category_id: null,
                category_name: null,
                memo: null,
                cleared: "uncleared",
                approved: false,
                deleted: false,
              },
            ],
          },
        }),
      );
      const txs = await client.getTransactions("2026-01-01");
      expect(txs).toHaveLength(2);
      expect(txs[0]).toMatchObject({
        amount: -25,
        cleared: true,
        approved: true,
      });
      expect(txs[1]).toMatchObject({
        amount: -10,
        cleared: false,
        approved: false,
      });
    });
  });

  describe("createTransaction", () => {
    it("sends correctly formatted payload", async () => {
      mockFetch.mockReturnValueOnce(
        jsonResponse({ data: { transaction: { id: "new-tx" } } }),
      );
      const id = await client.createTransaction({
        accountId: "acct-1",
        date: "2026-01-20",
        amount: -50,
        payeeName: "Store",
        categoryId: "cat-1",
        memo: "Test",
        cleared: true,
      });
      expect(id).toBe("new-tx");
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.transaction.amount).toBe(-50000); // dollars → milliunits
      expect(body.transaction.cleared).toBe("cleared");
    });

    it("includes a deterministic ledgr-prefixed import_id (M20)", async () => {
      // Same payload twice → same import_id. YNAB rejects duplicate
      // import_ids on the same account, so retry safety relies on the
      // hash being deterministic across calls.
      mockFetch.mockReturnValueOnce(
        jsonResponse({ data: { transaction: { id: "tx-a" } } }),
      );
      mockFetch.mockReturnValueOnce(
        jsonResponse({ data: { transaction: { id: "tx-b" } } }),
      );
      const payload = {
        accountId: "acct-1",
        date: "2026-01-20",
        amount: -50,
        payeeName: "Store",
        categoryId: "cat-1",
        memo: "Test",
        cleared: true,
      } as const;
      await client.createTransaction(payload);
      await client.createTransaction(payload);

      const body1 = JSON.parse(mockFetch.mock.calls[0][1].body);
      const body2 = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(body1.transaction.import_id).toMatch(/^ledgr:/);
      expect(body1.transaction.import_id.length).toBeLessThanOrEqual(36);
      expect(body1.transaction.import_id).toBe(body2.transaction.import_id);
    });

    it("defaults approved to true when not specified", async () => {
      mockFetch.mockReturnValueOnce(
        jsonResponse({ data: { transaction: { id: "tx-c" } } }),
      );
      await client.createTransaction({
        accountId: "a",
        date: "2026-01-20",
        amount: -10,
        payeeName: null,
        categoryId: null,
        memo: null,
        cleared: false,
      });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.transaction.approved).toBe(true);
    });
  });

  describe("getMonths", () => {
    it("filters returned months by date range", async () => {
      mockFetch.mockReturnValueOnce(
        jsonResponse({
          data: {
            months: [
              {
                month: "2025-12",
                income: 500000,
                budgeted: 400000,
                activity: -350000,
                to_be_budgeted: 100000,
              },
              {
                month: "2026-01",
                income: 600000,
                budgeted: 500000,
                activity: -450000,
                to_be_budgeted: 50000,
              },
              {
                month: "2026-02",
                income: 600000,
                budgeted: 500000,
                activity: -450000,
                to_be_budgeted: 50000,
              },
            ],
          },
        }),
      );
      const months = await client.getMonths("2026-01", "2026-02");
      expect(months).toHaveLength(2);
      expect(months[0].month).toBe("2026-01");
      expect(months[0].income).toBe(600); // milliunits → dollars
    });
  });

  describe("getMonthDetail", () => {
    it("maps the month with its categories and filters internal groups", async () => {
      mockFetch.mockReturnValueOnce(
        jsonResponse({
          data: {
            month: {
              month: "2026-01",
              income: 500000,
              budgeted: 400000,
              activity: -350000,
              to_be_budgeted: 100000,
              categories: [
                {
                  id: "c1",
                  name: "Rent",
                  category_group_id: "g1",
                  category_group_name: "Bills",
                  hidden: false,
                  budgeted: 1500000,
                  activity: -1500000,
                  balance: 0,
                  goal_target: null,
                  goal_type: null,
                  note: null,
                },
                {
                  id: "c-internal",
                  name: "Internal",
                  category_group_id: "g-internal",
                  category_group_name: "Internal Master Category",
                  hidden: true,
                  budgeted: 0,
                  activity: 0,
                  balance: 0,
                  goal_target: null,
                  goal_type: null,
                  note: null,
                },
              ],
            },
          },
        }),
      );
      const detail = await client.getMonthDetail("2026-01");
      expect(detail.month).toBe("2026-01");
      expect(detail.income).toBe(500);
      // Internal category filtered out
      expect(detail.categories).toHaveLength(1);
      expect(detail.categories[0]!.name).toBe("Rent");
    });
  });

  describe("updateCategoryBudgeted", () => {
    it("PATCHes the month/category endpoint with milliunits conversion", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({}));
      await client.updateCategoryBudgeted("2026-01", "cat-1", 150);
      const [url, init] = mockFetch.mock.calls[0]!;
      expect(url).toContain("/months/2026-01/categories/cat-1");
      expect(init.method).toBe("PATCH");
      const body = JSON.parse(init.body);
      expect(body.category.budgeted).toBe(150_000);
    });
  });

  describe("updateCategoryGoalTarget", () => {
    it("PATCHes the current month with milliunits conversion (plan-level)", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({}));
      await client.updateCategoryGoalTarget("cat-1", 500);
      const [url, init] = mockFetch.mock.calls[0]!;
      expect(url).toMatch(/\/months\/\d{4}-\d{2}-01\/categories\/cat-1/);
      expect(init.method).toBe("PATCH");
      const body = JSON.parse(init.body);
      expect(body.category.goal_target).toBe(500_000);
    });
  });

  describe("deleteTransaction", () => {
    it("sends a DELETE to /transactions/:id", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({}));
      await client.deleteTransaction("tx-1");
      const [url, init] = mockFetch.mock.calls[0]!;
      expect(url).toContain("/transactions/tx-1");
      expect(init.method).toBe("DELETE");
    });
  });

  describe("getAccountTransactions", () => {
    it("fetches transactions for a specific account and filters deleted ones", async () => {
      mockFetch.mockReturnValueOnce(
        jsonResponse({
          data: {
            transactions: [
              {
                id: "tx-1",
                account_id: "acct-1",
                account_name: "Checking",
                date: "2026-01-15",
                amount: -25000,
                payee_name: "Store",
                category_id: "c1",
                category_name: "Food",
                memo: null,
                cleared: "cleared",
                approved: true,
                deleted: false,
              },
              {
                id: "tx-2-deleted",
                account_id: "acct-1",
                account_name: "Checking",
                date: "2026-01-16",
                amount: -10000,
                payee_name: null,
                category_id: null,
                category_name: null,
                memo: null,
                cleared: "uncleared",
                approved: false,
                deleted: true,
              },
            ],
          },
        }),
      );
      const txs = await client.getAccountTransactions("acct-1", "2026-01-01");
      expect(txs).toHaveLength(1);
      expect(txs[0]!.id).toBe("tx-1");
    });
  });

  describe("updateTransaction", () => {
    it("only sends the fields that were specified", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({}));
      await client.updateTransaction("tx-1", {
        memo: "updated note",
      });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.transaction).toEqual({ memo: "updated note" });
      // Did NOT include amount, date, payee, etc.
      expect(body.transaction.amount).toBeUndefined();
      expect(body.transaction.payee_name).toBeUndefined();
    });

    it("converts amount to milliunits and cleared to YNAB enum", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({}));
      await client.updateTransaction("tx-2", {
        amount: -100,
        cleared: true,
      });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.transaction.amount).toBe(-100_000);
      expect(body.transaction.cleared).toBe("cleared");
    });
  });

  describe("updateTransaction", () => {
    it("sends partial update", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({}));
      await client.updateTransaction("tx-1", { amount: -75, cleared: false });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.transaction.amount).toBe(-75000);
      expect(body.transaction.cleared).toBe("uncleared");
    });
  });

  describe("getDelta", () => {
    it("returns mapped delta with server knowledge", async () => {
      mockFetch.mockReturnValueOnce(
        jsonResponse({
          data: {
            server_knowledge: 42,
            accounts: [],
            categories: [],
            transactions: [],
            months: [],
          },
        }),
      );
      const delta = await client.getDelta(10);
      expect(delta.serverKnowledge).toBe(42);
      expect(delta.data).toHaveProperty("accounts");
      expect(delta.data).toHaveProperty("transactions");
    });
  });

  describe("error handling", () => {
    it("throws a typed auth error on 401", async () => {
      // v0.5: ynab-client throws BudgetApiError instead of generic Error.
      // The auth code is non-retryable so the failure surfaces immediately.
      mockFetch.mockReturnValueOnce(jsonResponse({}, 401));
      await expect(client.getAccounts()).rejects.toThrow(
        /Authentication failed.*401/,
      );
    });
  });
});

describe("YNAB_INTERNAL_GROUPS", () => {
  it("contains known internal group names", () => {
    expect(YNAB_INTERNAL_GROUPS.has("Internal Master Category")).toBe(true);
    expect(YNAB_INTERNAL_GROUPS.has("Hidden Categories")).toBe(true);
  });
});
