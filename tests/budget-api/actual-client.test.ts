import { describe, it, expect, vi, beforeEach } from "vitest";
import { ActualClient } from "@/lib/budget-api/actual-client";

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

describe("ActualClient", () => {
  let client: ActualClient;

  beforeEach(() => {
    mockFetch.mockReset();
    client = new ActualClient(
      "http://actual.local",
      "test-api-key",
      "sync-id-123",
    );
  });

  it("does not support delta sync", () => {
    expect(client.supportsDeltaSync).toBe(false);
  });

  describe("testConnection", () => {
    it("returns true on success", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ data: [] }));
      expect(await client.testConnection()).toBe(true);
    });

    it("returns false on failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Connection refused"));
      expect(await client.testConnection()).toBe(false);
    });
  });

  describe("getBudgetName", () => {
    it("returns formatted sync ID", async () => {
      const name = await client.getBudgetName();
      expect(name).toContain("Actual");
      expect(name).toContain("sync-id-");
    });
  });

  describe("getAccounts", () => {
    it("maps Actual accounts to BudgetAccount format", async () => {
      // First call: /accounts list
      mockFetch.mockReturnValueOnce(
        jsonResponse({
          data: [
            {
              id: "acct-1",
              name: "Checking",
              type: "checking",
              offbudget: false,
              closed: false,
              balance: 15000, // cents = $150
            },
          ],
        }),
      );
      // Second call: /accounts/{id}/balance
      mockFetch.mockReturnValueOnce(jsonResponse({ data: { balance: 15000 } }));

      const accounts = await client.getAccounts();
      expect(accounts).toHaveLength(1);
      expect(accounts[0]).toMatchObject({
        id: "acct-1",
        name: "Checking",
        type: "checking",
        onBudget: true,
        closed: false,
        balance: 150,
      });
    });

    it("maps account types correctly", async () => {
      mockFetch.mockReturnValueOnce(
        jsonResponse({
          data: [
            {
              id: "a1",
              name: "Savings",
              type: "savings",
              offbudget: false,
              closed: false,
              balance: 0,
            },
            {
              id: "a2",
              name: "CC",
              type: "credit",
              offbudget: false,
              closed: false,
              balance: 0,
            },
            {
              id: "a3",
              name: "Invest",
              type: "investment",
              offbudget: true,
              closed: false,
              balance: 0,
            },
            {
              id: "a4",
              name: "Unknown",
              type: "weird",
              offbudget: false,
              closed: false,
              balance: 0,
            },
          ],
        }),
      );
      // Balance calls for each
      for (let i = 0; i < 4; i++) {
        mockFetch.mockReturnValueOnce(jsonResponse({ data: { balance: 0 } }));
      }

      const accounts = await client.getAccounts();
      expect(accounts[0].type).toBe("savings");
      expect(accounts[1].type).toBe("creditCard");
      expect(accounts[2].type).toBe("tracking");
      expect(accounts[3].type).toBe("other");
    });
  });

  describe("getAccountBalance", () => {
    it("returns balance in dollars from cents", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ data: { balance: 5000 } }));
      expect(await client.getAccountBalance("acct-1")).toBe(50);
    });
  });

  describe("getMonths", () => {
    it("filters months by date range", async () => {
      mockFetch.mockReturnValueOnce(
        jsonResponse({
          data: [
            {
              month: "2025-12",
              income: 500000,
              budgeted: 400000,
              spent: -350000,
              to_budget: 100000,
            },
            {
              month: "2026-01",
              income: 600000,
              budgeted: 500000,
              spent: -450000,
              to_budget: 50000,
            },
            {
              month: "2026-02",
              income: 600000,
              budgeted: 500000,
              spent: -450000,
              to_budget: 50000,
            },
          ],
        }),
      );
      const months = await client.getMonths("2026-01", "2026-02");
      expect(months).toHaveLength(2);
      expect(months[0].month).toBe("2026-01");
      expect(months[0].income).toBe(6000); // 600000 cents = $6000
    });
  });

  describe("createTransaction", () => {
    it("sends correctly formatted payload in cents", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ data: { id: "new-tx" } }));
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
      expect(body.amount).toBe(-5000); // dollars → cents
      expect(body.cleared).toBe(true);
    });

    it("includes a deterministic ledgr-prefixed imported_id (M20)", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ data: { id: "tx-a" } }));
      mockFetch.mockReturnValueOnce(jsonResponse({ data: { id: "tx-b" } }));
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
      expect(body1.imported_id).toMatch(/^ledgr:/);
      expect(body1.imported_id).toBe(body2.imported_id);
    });
  });

  describe("updateTransaction", () => {
    it("sends partial update with cents conversion", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({}));
      await client.updateTransaction("tx-1", {
        amount: -75,
        memo: "Updated",
      });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.amount).toBe(-7500);
      expect(body.notes).toBe("Updated");
    });
  });

  describe("updateCategoryGoalTarget", () => {
    it("is a no-op (Actual does not support goals)", async () => {
      // Should not throw, should not call fetch
      await client.updateCategoryGoalTarget("cat-1", 500);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("getCategories", () => {
    it("merges categories into groups and maps cents to dollars", async () => {
      // /categorygroups + /categories are fetched in parallel and merged
      // by group_id. We provide both responses in the order the client
      // fires them (Promise.all → request 1 then request 2 on Actual's
      // HTTP impl; the test tolerates both orders by returning the same
      // shape twice).
      mockFetch.mockReturnValueOnce(
        jsonResponse({
          data: [
            {
              id: "g1",
              name: "Bills",
              is_income: false,
              hidden: false,
              categories: [],
            },
          ],
        }),
      );
      mockFetch.mockReturnValueOnce(
        jsonResponse({
          data: [
            {
              id: "c1",
              name: "Rent",
              group_id: "g1",
              hidden: false,
              budgeted: 150000, // cents = $1500
              spent: -140000,
              balance: 10000,
            },
          ],
        }),
      );
      const groups = await client.getCategories();
      expect(groups).toHaveLength(1);
      expect(groups[0]!.name).toBe("Bills");
      expect(groups[0]!.categories[0]).toMatchObject({
        name: "Rent",
        budgeted: 1500,
      });
    });
  });

  describe("getMonthDetail", () => {
    it("maps the month with its categories", async () => {
      mockFetch.mockReturnValueOnce(
        jsonResponse({
          data: {
            month: "2026-01",
            income: 500000,
            budgeted: 400000,
            spent: -350000,
            to_budget: 100000,
            categories: [
              {
                id: "c1",
                name: "Rent",
                group_id: "g1",
                hidden: false,
                budgeted: 150000,
                spent: -140000,
                balance: 10000,
              },
            ],
          },
        }),
      );
      const detail = await client.getMonthDetail("2026-01");
      expect(detail.month).toBe("2026-01");
      expect(detail.income).toBe(5000);
      expect(detail.categories).toHaveLength(1);
    });
  });

  describe("updateCategoryBudgeted", () => {
    it("PATCHes with cents conversion", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({}));
      await client.updateCategoryBudgeted("2026-01", "cat-1", 150);
      const [, init] = mockFetch.mock.calls[0]!;
      expect(init.method).toBe("PATCH");
      expect(JSON.parse(init.body).budgeted).toBe(15000);
    });
  });

  describe("getTransactions", () => {
    it("aggregates transactions across open accounts, skipping closed", async () => {
      // Response 1: /accounts — two accounts, one closed
      mockFetch.mockReturnValueOnce(
        jsonResponse({
          data: [
            {
              id: "a1",
              name: "Checking",
              type: "checking",
              offbudget: false,
              closed: false,
              balance: 0,
            },
            {
              id: "a2",
              name: "Old Savings",
              type: "savings",
              offbudget: false,
              closed: true, // closed → should be skipped
              balance: 0,
            },
          ],
        }),
      );
      // Response 2: /accounts/a1/transactions
      mockFetch.mockReturnValueOnce(
        jsonResponse({
          data: [
            {
              id: "tx-1",
              account: "a1",
              date: "2026-01-10",
              amount: -5000, // $-50
              payee: "p1",
              payee_name: "Store",
              notes: "test",
              cleared: true,
              reconciled: false,
            },
          ],
        }),
      );
      const txs = await client.getTransactions("2026-01-01");
      // Only one account's transactions returned — the closed account
      // was never fetched.
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(txs).toHaveLength(1);
      expect(txs[0]).toMatchObject({
        id: "tx-1",
        accountId: "a1",
        accountName: "Checking",
        amount: -50,
      });
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
    it("fetches + maps transactions for a specific account", async () => {
      mockFetch.mockReturnValueOnce(
        jsonResponse({
          data: [
            {
              id: "tx-2",
              account: "a1",
              date: "2026-01-15",
              amount: -2500,
              payee_name: "Coffee",
              notes: null,
              cleared: false,
              reconciled: false,
            },
          ],
        }),
      );
      const txs = await client.getAccountTransactions("a1", "2026-01-01");
      expect(txs).toHaveLength(1);
      expect(txs[0]!.amount).toBe(-25);
      expect(txs[0]!.cleared).toBe(false);
    });
  });

  describe("error handling", () => {
    it("throws a typed auth error on 401 (M19)", async () => {
      // v0.5: actual-client throws BudgetApiError instead of generic Error.
      // The auth code is non-retryable so the failure surfaces immediately
      // (avoids the 3-attempt backoff that retryable codes incur).
      mockFetch.mockReturnValueOnce(jsonResponse({}, 401));
      await expect(client.getAccountBalance("x")).rejects.toThrow(
        /Authentication failed.*401/,
      );
    });
  });

  describe("URL construction", () => {
    it("strips trailing slash from server URL", () => {
      const c = new ActualClient("http://actual.local/", "key", "sync-id");
      mockFetch.mockReturnValueOnce(jsonResponse({ data: [] }));
      c.testConnection();
      const url = mockFetch.mock.calls[0][0];
      expect(url).not.toContain("//v1");
    });
  });
});
