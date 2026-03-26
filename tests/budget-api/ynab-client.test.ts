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
    it("throws on non-OK response", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({}, 401));
      await expect(client.getAccounts()).rejects.toThrow("YNAB API 401");
    });
  });
});

describe("YNAB_INTERNAL_GROUPS", () => {
  it("contains known internal group names", () => {
    expect(YNAB_INTERNAL_GROUPS.has("Internal Master Category")).toBe(true);
    expect(YNAB_INTERNAL_GROUPS.has("Hidden Categories")).toBe(true);
  });
});
