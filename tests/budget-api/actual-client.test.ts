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

  describe("error handling", () => {
    it("throws on non-OK response", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({}, 500));
      await expect(client.getAccountBalance("x")).rejects.toThrow(
        "Actual API 500",
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
