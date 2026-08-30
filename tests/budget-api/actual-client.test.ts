import { describe, it, expect, vi, beforeEach } from "vitest";
import { ActualClient } from "@/lib/budget-api/actual-client";
import { BudgetApiError } from "@/lib/budget-api/errors";

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
      mockFetch.mockReturnValueOnce(jsonResponse({ data: 15000 }));

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
        mockFetch.mockReturnValueOnce(jsonResponse({ data: 0 }));
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
      mockFetch.mockReturnValueOnce(jsonResponse({ data: 5000 }));
      expect(await client.getAccountBalance("acct-1")).toBe(50);
    });
  });

  describe("getMonths", () => {
    // GET /months returns a bare array of month-id strings, NOT rich
    // month objects — re-verified live against a deployed actual-http-api
    // instance (148-entry array of strings like "2027-07"). Real data only
    // comes from GET /months/:id, so getMonths filters the id list to the
    // requested range and fetches each one's detail.
    it("filters month ids by date range, then fetches each one's real detail", async () => {
      mockFetch.mockReturnValueOnce(
        jsonResponse({ data: ["2025-12", "2026-01", "2026-02"] }),
      );
      const monthDetail = (month: string, totalIncome: number) =>
        jsonResponse({
          data: {
            month,
            totalIncome,
            totalBudgeted: -500000,
            totalSpent: -450000,
            toBudget: 50000,
            categoryGroups: [],
          },
        });
      mockFetch.mockReturnValueOnce(monthDetail("2026-01", 600000));
      mockFetch.mockReturnValueOnce(monthDetail("2026-02", 600000));

      const months = await client.getMonths("2026-01", "2026-02");
      expect(months).toHaveLength(2);
      expect(months[0].month).toBe("2026-01");
      expect(months[0].income).toBe(6000); // 600000 cents = $6000
      // 2025-12 is out of range — only 3 fetch calls total (list + 2 details).
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe("createTransaction", () => {
    // Real response is `{"message":"ok"}` — confirmed LIVE against a
    // deployed actual-http-api instance, both with and without imported_id
    // set. It never returns the created transaction's id, so the client
    // looks it back up by its own deterministic imported_id immediately
    // after POSTing — that's what these mocks exercise (POST, then a GET
    // whose data includes the newly "created" row).
    it("sends correctly formatted payload in cents, nested under `transaction`", async () => {
      let sentImportedId = "";
      mockFetch.mockImplementationOnce(
        async (_url: string, init: RequestInit) => {
          sentImportedId = JSON.parse(init.body as string).transaction
            .imported_id;
          return jsonResponse({ message: "ok" });
        },
      );
      mockFetch.mockImplementationOnce(async () =>
        jsonResponse({
          data: [
            {
              id: "new-tx",
              account: "acct-1",
              date: "2026-01-20",
              amount: -5000,
              cleared: true,
              reconciled: false,
              imported_id: sentImportedId,
            },
          ],
        }),
      );

      await client.createTransaction({
        accountId: "acct-1",
        date: "2026-01-20",
        amount: -50,
        payeeName: "Store",
        categoryId: "cat-1",
        memo: "Test",
        cleared: true,
      });
      const postBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(postBody.transaction.account).toBe("acct-1");
      expect(postBody.transaction.amount).toBe(-5000); // dollars → cents
      expect(postBody.transaction.cleared).toBe(true);
    });

    it("looks the transaction up by imported_id and returns its real id, not the POST response", async () => {
      const importedIdCapture: { value?: string } = {};
      mockFetch.mockImplementationOnce(
        async (_url: string, init: RequestInit) => {
          importedIdCapture.value = JSON.parse(
            init.body as string,
          ).transaction.imported_id;
          return jsonResponse({ message: "ok" });
        },
      );
      mockFetch.mockImplementationOnce(async () =>
        jsonResponse({
          data: [
            {
              id: "real-tx-id",
              account: "acct-1",
              date: "2026-01-20",
              amount: -5000,
              cleared: true,
              reconciled: false,
              imported_id: importedIdCapture.value,
            },
          ],
        }),
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
      expect(id).toBe("real-tx-id");
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[1][0]).toContain(
        "/accounts/acct-1/transactions?since_date=2026-01-20",
      );
    });

    it("throws when the created transaction can't be found back by imported_id", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ message: "ok" })); // POST
      mockFetch.mockReturnValueOnce(jsonResponse({ data: [] })); // GET — nothing found
      await expect(
        client.createTransaction({
          accountId: "acct-1",
          date: "2026-01-20",
          amount: -50,
          payeeName: "Store",
          categoryId: "cat-1",
          memo: "Test",
          cleared: true,
        }),
      ).rejects.toBeInstanceOf(BudgetApiError);
    });

    it("includes a deterministic ledgr-prefixed imported_id (M20)", async () => {
      const capture: string[] = [];
      const fakeLookup = () =>
        jsonResponse({
          data: [
            {
              id: "tx-x",
              account: "acct-1",
              date: "2026-01-20",
              amount: -5000,
              cleared: true,
              reconciled: false,
              imported_id: capture[capture.length - 1],
            },
          ],
        });
      mockFetch.mockImplementationOnce(
        async (_url: string, init: RequestInit) => {
          capture.push(JSON.parse(init.body as string).transaction.imported_id);
          return jsonResponse({ message: "ok" });
        },
      );
      mockFetch.mockImplementationOnce(fakeLookup);
      mockFetch.mockImplementationOnce(
        async (_url: string, init: RequestInit) => {
          capture.push(JSON.parse(init.body as string).transaction.imported_id);
          return jsonResponse({ message: "ok" });
        },
      );
      mockFetch.mockImplementationOnce(fakeLookup);

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
      expect(capture[0]).toMatch(/^ledgr:/);
      expect(capture[0]).toBe(capture[1]);
    });

    it("sends reconciled: true and derives cleared: true, even if cleared wasn't set", async () => {
      let sentImportedId = "";
      mockFetch.mockImplementationOnce(
        async (_url: string, init: RequestInit) => {
          sentImportedId = JSON.parse(init.body as string).transaction
            .imported_id;
          return jsonResponse({ message: "ok" });
        },
      );
      mockFetch.mockImplementationOnce(async () =>
        jsonResponse({
          data: [
            {
              id: "tx-recon",
              account: "acct-1",
              date: "2026-01-20",
              amount: -5000,
              cleared: true,
              reconciled: true,
              imported_id: sentImportedId,
            },
          ],
        }),
      );
      await client.createTransaction({
        accountId: "acct-1",
        date: "2026-01-20",
        amount: -50,
        reconciled: true,
      });
      const postBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(postBody.transaction.reconciled).toBe(true);
      expect(postBody.transaction.cleared).toBe(true);
    });
  });

  describe("updateTransaction", () => {
    it("sends partial update with cents conversion, nested under `transaction`", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({}));
      await client.updateTransaction("tx-1", {
        amount: -75,
        memo: "Updated",
      });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.transaction.amount).toBe(-7500);
      expect(body.transaction.notes).toBe("Updated");
    });

    it("sets cleared: true when reconciled: true is sent, even without an explicit cleared field", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({}));
      await client.updateTransaction("tx-1", { reconciled: true });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.transaction.reconciled).toBe(true);
      expect(body.transaction.cleared).toBe(true);
    });
  });

  // updateCategoryGoalTarget / updateCategoryTargetBalance write via
  // Actual's note-based #template mechanism — there's no structured goal
  // field the API can write (verified against @actual-app/api's docs).
  // See actual-goal-notes.ts for the pure merge logic; these tests cover
  // the HTTP plumbing (GET note → merge → PUT note) around it.
  describe("updateCategoryGoalTarget", () => {
    it("appends a fresh #template line when the category has no note yet", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ data: null })); // GET
      mockFetch.mockReturnValueOnce(jsonResponse({ message: "ok" })); // PUT
      await client.updateCategoryGoalTarget("cat-1", 250);
      const [getCall, putCall] = mockFetch.mock.calls;
      expect(getCall[0]).toContain("/notes/category/cat-1");
      expect(putCall[0]).toContain("/notes/category/cat-1");
      expect(putCall[1].method).toBe("PUT");
      expect(JSON.parse(putCall[1].body).data).toBe("#template 250");
    });

    it("replaces just the amount when a matching-shape #template already exists, preserving other note text", async () => {
      mockFetch.mockReturnValueOnce(
        jsonResponse({ data: "Rent category\n#template 100" }),
      );
      mockFetch.mockReturnValueOnce(jsonResponse({ message: "ok" }));
      await client.updateCategoryGoalTarget("cat-1", 175);
      const putCall = mockFetch.mock.calls[1];
      expect(JSON.parse(putCall[1].body).data).toBe(
        "Rent category\n#template 175",
      );
    });

    it("throws a BudgetApiError with code 'conflict' and does NOT call PUT when an incompatible #template already exists", async () => {
      mockFetch.mockReturnValueOnce(
        jsonResponse({ data: "#template 10% of Paycheck" }),
      );
      await expect(
        client.updateCategoryGoalTarget("cat-1", 250),
      ).rejects.toMatchObject({ name: "BudgetApiError", code: "conflict" });
      expect(mockFetch).toHaveBeenCalledTimes(1); // only the GET
    });

    it("rejects with a real BudgetApiError instance on conflict (not a generic Error)", async () => {
      mockFetch.mockReturnValueOnce(
        jsonResponse({ data: "#template 10% of Paycheck" }),
      );
      await expect(
        client.updateCategoryGoalTarget("cat-1", 250),
      ).rejects.toBeInstanceOf(BudgetApiError);
    });
  });

  describe("updateCategoryTargetBalance", () => {
    it("writes an 'up to' template, distinct from the fixed-amount shape", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ data: null }));
      mockFetch.mockReturnValueOnce(jsonResponse({ message: "ok" }));
      await client.updateCategoryTargetBalance("cat-1", 5000);
      const putCall = mockFetch.mock.calls[1];
      expect(JSON.parse(putCall[1].body).data).toBe("#template up to 5000");
    });

    it("a fixed-amount template does not satisfy a target-balance write — treated as conflict, not replaced", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ data: "#template 100" }));
      await expect(
        client.updateCategoryTargetBalance("cat-1", 5000),
      ).rejects.toMatchObject({ code: "conflict" });
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
    // Real shape re-verified live: totalIncome/totalBudgeted/totalSpent/
    // toBudget at the top level, categories nested under categoryGroups —
    // NOT a flat top-level `categories` array. The old flat-shaped mock
    // (and matching client code) meant this ALWAYS returned an empty
    // categories array against the real wrapper — see mapMonthDetail's
    // docblock.
    it("maps the month summary and flattens categoryGroups into one categories array", async () => {
      mockFetch.mockReturnValueOnce(
        jsonResponse({
          data: {
            month: "2026-01",
            totalIncome: 500000,
            totalBudgeted: -400000,
            totalSpent: -350000,
            toBudget: 100000,
            categoryGroups: [
              {
                id: "g1",
                name: "Housing",
                is_income: false,
                hidden: false,
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
              {
                id: "g2",
                name: "Food",
                is_income: false,
                hidden: false,
                categories: [
                  {
                    id: "c2",
                    name: "Groceries",
                    group_id: "g2",
                    hidden: false,
                    budgeted: 60000,
                    spent: -55000,
                    balance: 5000,
                  },
                ],
              },
            ],
          },
        }),
      );
      const detail = await client.getMonthDetail("2026-01");
      expect(detail.month).toBe("2026-01");
      const url = mockFetch.mock.calls[0]![0] as string;
      expect(url).toContain("/months/2026-01");
      expect(detail.income).toBe(5000);
      // totalBudgeted comes back negative from Actual — mapped to a
      // positive dollar amount matching the per-category convention.
      expect(detail.budgeted).toBe(4000);
      expect(detail.categories).toHaveLength(2);
      expect(detail.categories.map((c) => c.name)).toEqual([
        "Rent",
        "Groceries",
      ]);
      expect(detail.categories[0].groupName).toBe("Housing");
      expect(detail.categories[1].groupName).toBe("Food");
    });

    // Live-user bug, 2026-08-30: every caller in this codebase
    // (sync/core.ts, budget-api/cache.ts) computes `month` as YNAB's own
    // native format, `YYYY-MM-01` (a full ISO date) -- correct for YNAB's
    // real API, but Actual's actual-http-api wrapper's `/months/:id` route
    // rejects anything but the shorter `YYYY-MM` with a real 400 error
    // ("Invalid month format, use YYYY-MM: 2026-08-01"). This was a
    // genuine, previously-unexercised bug: the pre-existing test above
    // only ever passed the already-short "2026-01" form, so the mismatch
    // never surfaced until a real sync attempt hit it live.
    it("strips the day component from a YYYY-MM-01 month before building the URL (Actual's API rejects the day)", async () => {
      mockFetch.mockReturnValueOnce(
        jsonResponse({
          data: {
            month: "2026-08",
            totalIncome: 0,
            totalBudgeted: 0,
            totalSpent: 0,
            toBudget: 0,
            categoryGroups: [],
          },
        }),
      );
      await client.getMonthDetail("2026-08-01");
      const url = mockFetch.mock.calls[0]![0] as string;
      expect(url).toContain("/months/2026-08");
      expect(url).not.toContain("2026-08-01");
    });
  });

  describe("updateCategoryBudgeted", () => {
    it("PATCHes with cents conversion, nested under `category` (actual-http-api's real request shape)", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({}));
      await client.updateCategoryBudgeted("2026-01", "cat-1", 150);
      const [url, init] = mockFetch.mock.calls[0]!;
      expect(url).toContain("/months/2026-01");
      expect(init.method).toBe("PATCH");
      expect(JSON.parse(init.body).category.budgeted).toBe(15000);
    });

    it("also strips the day component from a YYYY-MM-01 month", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({}));
      await client.updateCategoryBudgeted("2026-08-01", "cat-1", 150);
      const url = mockFetch.mock.calls[0]![0] as string;
      expect(url).toContain("/months/2026-08/categories/cat-1");
      expect(url).not.toContain("2026-08-01");
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
