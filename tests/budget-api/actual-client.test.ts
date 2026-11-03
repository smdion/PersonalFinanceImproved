import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BudgetAPIClient } from "@/lib/budget-api/interface";
import {
  ActualClient,
  resetActualWrapperGates,
} from "@/lib/budget-api/actual-client";
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

/** Prepare a goal write, then apply it: what a push does per item. */
async function pushGoal(
  client: BudgetAPIClient,
  categoryId: string,
  shape: "monthly" | "target-balance",
  amount: number,
) {
  const write = await client.prepareGoalWrite(categoryId, shape, amount);
  await write.apply();
}

describe("ActualClient", () => {
  let client: ActualClient;

  beforeEach(() => {
    mockFetch.mockReset();
    resetActualWrapperGates();
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
        type: "other",
        onBudget: true,
        closed: false,
        balance: 150,
      });
    });

    it('every account is "other": the wrapper\'s list carries no type', async () => {
      mockFetch.mockReturnValueOnce(
        jsonResponse({
          data: [
            { id: "a1", name: "Savings", offbudget: false, closed: false },
            { id: "a2", name: "Invest", offbudget: true, closed: false },
          ],
        }),
      );
      mockFetch.mockReturnValue(jsonResponse({ data: 0 }));
      const accounts = await client.getAccounts();
      expect(accounts.map((a) => a.type)).toEqual(["other", "other"]);
    });
  });

  describe("getAccounts — a balance that won't come", () => {
    const list = jsonResponse({
      data: [
        {
          id: "a1",
          name: "Checking",
          type: "checking",
          offbudget: false,
          closed: false,
        },
        {
          id: "a2",
          name: "Car loan",
          type: "other",
          offbudget: true,
          closed: false,
        },
      ],
    });

    it("a balance failing in the parallel pass is retried on its own", async () => {
      let a2Calls = 0;
      mockFetch.mockImplementation((url: string) => {
        if (url.endsWith("/accounts")) return list;
        if (url.includes("/a2/")) {
          a2Calls++;
          if (a2Calls === 1)
            return Promise.reject(new TypeError("fetch failed"));
          return jsonResponse({ data: -1234500 });
        }
        return jsonResponse({ data: 50000 });
      });
      const accounts = await client.getAccounts();
      expect(accounts.map((a) => a.balance)).toEqual([500, -12345]);
    });

    it("still failing, the sync stops — never a $0 balance", async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.endsWith("/accounts")) return list;
        if (url.includes("/a2/"))
          return Promise.reject(new TypeError("fetch failed"));
        return jsonResponse({ data: 50000 });
      });
      await expect(client.getAccounts()).rejects.toThrow(
        /didn't return a balance for Car loan — nothing was synced/,
      );
    });

    it("the error keeps the failure's code, never a plain Error", async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.endsWith("/accounts")) return list;
        if (url.includes("/a2/"))
          return Promise.reject(new TypeError("fetch failed"));
        return jsonResponse({ data: 50000 });
      });
      await expect(client.getAccounts()).rejects.toMatchObject({
        name: "BudgetApiError",
        code: "network",
      });
    });

    it("a failure that isn't transient stops at once, without the second try", async () => {
      let a2Calls = 0;
      mockFetch.mockImplementation((url: string) => {
        if (url.endsWith("/accounts")) return list;
        if (url.includes("/a2/")) {
          a2Calls++;
          return jsonResponse({ error: "unauthorized" }, 401);
        }
        return jsonResponse({ data: 50000 });
      });
      await expect(client.getAccounts()).rejects.toMatchObject({
        code: "auth",
      });
      expect(a2Calls).toBe(1);
    });
  });

  describe("getTransactions — an account that won't answer", () => {
    const list = jsonResponse({
      data: [
        { id: "a1", name: "Checking", type: "checking", closed: false },
        { id: "a2", name: "Savings", type: "savings", closed: false },
      ],
    });
    const tx = {
      id: "t1",
      date: "2026-01-02",
      amount: -500,
      account: "a1",
      payee_name: "Shop",
    };

    it("skips an account that is gone (404) and keeps the rest", async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.endsWith("/accounts")) return list;
        if (url.includes("/a2/")) return jsonResponse({ error: "no" }, 404);
        return jsonResponse({ data: [tx] });
      });
      const out = await client.getTransactions("2026-01-01");
      expect(out).toHaveLength(1);
    });

    it("a non-404 failure stops the sync and names the account", async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.endsWith("/accounts")) return list;
        if (url.includes("/a2/")) return jsonResponse({ error: "no" }, 401);
        return jsonResponse({ data: [tx] });
      });
      await expect(client.getTransactions("2026-01-01")).rejects.toThrow(
        /transactions for Savings — nothing was synced/,
      );
    });

    it("a network failure stops the sync too", async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.endsWith("/accounts")) return list;
        if (url.includes("/a2/"))
          return Promise.reject(new TypeError("fetch failed"));
        return jsonResponse({ data: [tx] });
      });
      await expect(client.getTransactions("2026-01-01")).rejects.toThrow(
        /Savings/,
      );
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
      expect(months[0]!.month).toBe("2026-01");
      expect(months[0]!.income).toBe(6000); // 600000 cents = $6000
      // 2025-12 is out of range — only 3 fetch calls total (list + 2 details).
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe("findCreatedTransaction", () => {
    const tx = {
      importKey: "push-1",
      accountId: "acct-1",
      date: "2026-01-20",
      amount: -50,
      payeeName: "Store",
      memo: "Test",
    };

    it("finds the transaction createTransaction posted, by its imported_id, on that day only", async () => {
      let sentImportedId = "";
      mockFetch.mockImplementationOnce(
        async (_url: string, init: RequestInit) => {
          sentImportedId = JSON.parse(init.body as string).transaction
            .imported_id;
          return jsonResponse({ message: "ok" });
        },
      );
      mockFetch.mockImplementation(async () =>
        jsonResponse({
          data: [
            { id: "other", imported_id: "ledgr:else" },
            { id: "posted", imported_id: sentImportedId },
          ],
        }),
      );
      await client.createTransaction(tx);
      expect(await client.findCreatedTransaction(tx)).toBe("posted");
      const listUrl = mockFetch.mock.calls.at(-1)![0] as string;
      expect(listUrl).toContain("since_date=2026-01-20&until_date=2026-01-20");
    });

    it("null when nothing carries its imported_id", async () => {
      mockFetch.mockReturnValueOnce(
        jsonResponse({ data: [{ id: "other", imported_id: "ledgr:else" }] }),
      );
      expect(await client.findCreatedTransaction(tx)).toBeNull();
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
        importKey: "push-1",
        accountId: "acct-1",
        date: "2026-01-20",
        amount: -50,
        payeeName: "Store",
        categoryId: "cat-1",
        memo: "Test",
        cleared: true,
      });
      const postBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
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
        importKey: "push-1",
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
      expect(mockFetch.mock.calls[1]![0]).toContain(
        "/accounts/acct-1/transactions?since_date=2026-01-20",
      );
    });

    it("throws when the created transaction can't be found back by imported_id", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ message: "ok" })); // POST
      mockFetch.mockReturnValueOnce(jsonResponse({ data: [] })); // GET — nothing found
      await expect(
        client.createTransaction({
          importKey: "push-1",
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
        importKey: "push-1",
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
        importKey: "push-1",
        accountId: "acct-1",
        date: "2026-01-20",
        amount: -50,
        reconciled: true,
      });
      const postBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
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
      const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(body.transaction.amount).toBe(-7500);
      expect(body.transaction.notes).toBe("Updated");
    });

    it("sets cleared: true when reconciled: true is sent, even without an explicit cleared field", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({}));
      await client.updateTransaction("tx-1", { reconciled: true });
      const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(body.transaction.reconciled).toBe(true);
      expect(body.transaction.cleared).toBe(true);
    });
  });

  // Goal writes (prepareGoalWrite, then apply) go through
  // Actual's note-based #template mechanism — there's no structured goal
  // field the API can write (verified against @actual-app/api's docs).
  // See actual-goal-notes.ts for the pure merge logic; these tests cover
  // the HTTP plumbing (GET note → merge → PUT note) around it.
  describe("prepareGoalWrite: monthly", () => {
    it("appends a fresh #template line when the category has no note yet", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ data: null })); // GET
      mockFetch.mockReturnValueOnce(jsonResponse({ message: "ok" })); // PUT
      await pushGoal(client, "cat-1", "monthly", 250);
      const [getCall, putCall] = mockFetch.mock.calls;
      expect(getCall![0]).toContain("/notes/category/cat-1");
      expect(putCall![0]).toContain("/notes/category/cat-1");
      expect(putCall![1].method).toBe("PUT");
      expect(JSON.parse(putCall![1].body).data).toBe("#template 250");
    });

    it("replaces just the amount when a matching-shape #template already exists, preserving other note text", async () => {
      mockFetch.mockReturnValueOnce(
        jsonResponse({ data: "Rent category\n#template 100" }),
      );
      mockFetch.mockReturnValueOnce(jsonResponse({ message: "ok" }));
      await pushGoal(client, "cat-1", "monthly", 175);
      const putCall = mockFetch.mock.calls[1];
      expect(JSON.parse(putCall![1].body).data).toBe(
        "Rent category\n#template 175",
      );
    });

    it("throws a BudgetApiError with code 'conflict' and does NOT call PUT when an incompatible #template already exists", async () => {
      mockFetch.mockReturnValueOnce(
        jsonResponse({ data: "#template 10% of Paycheck" }),
      );
      await expect(
        pushGoal(client, "cat-1", "monthly", 250),
      ).rejects.toMatchObject({ name: "BudgetApiError", code: "conflict" });
      expect(mockFetch).toHaveBeenCalledTimes(1); // only the GET
    });

    it("rejects with a real BudgetApiError instance on conflict (not a generic Error)", async () => {
      mockFetch.mockReturnValueOnce(
        jsonResponse({ data: "#template 10% of Paycheck" }),
      );
      await expect(
        pushGoal(client, "cat-1", "monthly", 250),
      ).rejects.toBeInstanceOf(BudgetApiError);
    });
  });

  describe("prepareGoalWrite: reads only", () => {
    it("reads the note when prepared and writes it only on apply", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ data: null }));
      const write = await client.prepareGoalWrite("cat-1", "monthly", 250);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0]![1]?.method ?? "GET").toBe("GET");
      mockFetch.mockReturnValueOnce(jsonResponse({ message: "ok" }));
      await write.apply();
      expect(mockFetch.mock.calls[1]![1].method).toBe("PUT");
    });
  });

  describe("prepareGoalWrite: target-balance", () => {
    it("writes an 'up to' template, distinct from the fixed-amount shape", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ data: null }));
      mockFetch.mockReturnValueOnce(jsonResponse({ message: "ok" }));
      await pushGoal(client, "cat-1", "target-balance", 5000);
      const putCall = mockFetch.mock.calls[1];
      expect(JSON.parse(putCall![1].body).data).toBe("#template up to 5000");
    });

    it("a fixed-amount template does not satisfy a target-balance write — treated as conflict, not replaced", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ data: "#template 100" }));
      await expect(
        pushGoal(client, "cat-1", "target-balance", 5000),
      ).rejects.toMatchObject({ code: "conflict" });
    });
  });

  describe("getCategories", () => {
    it("merges categories into groups, enriched with the current month's real numbers", async () => {
      // Verified live, 2026-08-31: the bare /categorygroups + /categories
      // endpoints carry only id/name/hidden/group_id — NO budgeted/spent/
      // balance/goal keys at all (unlike YNAB, whose categories endpoint
      // does carry a real running balance). Those numbers are inherently
      // month-scoped in Actual and only come back from /months/:id, which
      // getCategories() now fetches and merges in by category id. This
      // test previously mocked budgeted/spent/balance directly on the bare
      // /categories response — a shape that doesn't exist on Actual's real
      // API and silently encoded the bug (every Actual household's
      // category/goal balance read as $0).
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
            },
          ],
        }),
      );
      mockFetch.mockReturnValueOnce(
        jsonResponse({
          data: {
            month: "2026-08",
            totalIncome: 0,
            totalBudgeted: 0,
            totalSpent: 0,
            toBudget: 0,
            categoryGroups: [
              {
                id: "g1",
                name: "Bills",
                is_income: false,
                hidden: false,
                categories: [
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
              },
            ],
          },
        }),
      );
      // getCategories() now also overlays note-parsed goal amounts (see
      // overlayNoteGoals) -- one GET /notes/category/:id per category.
      // No #template here, so this category's goalTarget stays whatever
      // getMonthDetail/mapCategory already produced (undefined -- this
      // fixture doesn't set a `goal` field either).
      mockFetch.mockReturnValueOnce(jsonResponse({ data: null }));
      const groups = await client.getCategories();
      expect(groups).toHaveLength(1);
      expect(groups[0]!.name).toBe("Bills");
      expect(groups[0]!.categories[0]).toMatchObject({
        name: "Rent",
        budgeted: 1500,
        balance: 100,
      });
    });

    it("falls back to $0 for a category the current month doesn't report (no crash)", async () => {
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
          data: [{ id: "c1", name: "Rent", group_id: "g1", hidden: false }],
        }),
      );
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
      mockFetch.mockReturnValueOnce(jsonResponse({ data: null }));
      const groups = await client.getCategories();
      expect(groups[0]!.categories[0]).toMatchObject({
        name: "Rent",
        budgeted: 0,
        balance: 0,
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
      // getMonthDetail() overlays note-parsed goal amounts (see
      // overlayNoteGoals) -- one GET /notes/category/:id per category,
      // no #template in either fixture so goalTarget is unaffected here.
      mockFetch.mockReturnValueOnce(jsonResponse({ data: null }));
      mockFetch.mockReturnValueOnce(jsonResponse({ data: null }));
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
      expect(detail.categories[0]!.groupName).toBe("Housing");
      expect(detail.categories[1]!.groupName).toBe("Food");
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

    // Found live, 2026-09-01: a budget push-preview showed every linked
    // category's "current" value as $0, even for categories already
    // pushed successfully -- goalTarget was reading Actual's structured
    // `goal` field, which prepareGoalWrite's note-based write never touches.
    // overlayNoteGoals is the fix: read the note back and prefer it.
    it("overrides goalTarget with the note-parsed amount when a #template is present, even though the structured goal field says something else", async () => {
      mockFetch.mockReturnValueOnce(
        jsonResponse({
          data: {
            month: "2026-01",
            totalIncome: 0,
            totalBudgeted: 0,
            totalSpent: 0,
            toBudget: 0,
            categoryGroups: [
              {
                id: "g1",
                name: "Bills",
                is_income: false,
                hidden: false,
                categories: [
                  {
                    id: "c1",
                    name: "Rent",
                    group_id: "g1",
                    hidden: false,
                    goal: 0, // structured field: stale/never-written
                  },
                ],
              },
            ],
          },
        }),
      );
      mockFetch.mockReturnValueOnce(jsonResponse({ data: "#template 450" }));
      const detail = await client.getMonthDetail("2026-01");
      expect(detail.categories[0]!.goalTarget).toBe(450);
      const noteCall = mockFetch.mock.calls[1]!;
      expect(noteCall[0]).toContain("/notes/category/c1");
    });

    it("a category has no goal unless its note has a #template: Actual sends no goal field", async () => {
      mockFetch.mockReturnValueOnce(
        jsonResponse({
          data: {
            month: "2026-01",
            totalIncome: 0,
            totalBudgeted: 0,
            totalSpent: 0,
            toBudget: 0,
            categoryGroups: [
              {
                id: "g1",
                name: "Bills",
                is_income: false,
                hidden: false,
                categories: [
                  {
                    id: "c1",
                    name: "Rent",
                    group_id: "g1",
                    hidden: false,
                    goal: 30000, // $300, set directly in Actual's own UI
                  },
                ],
              },
            ],
          },
        }),
      );
      mockFetch.mockReturnValueOnce(
        jsonResponse({ data: "Just a free-text note, no goal" }),
      );
      const detail = await client.getMonthDetail("2026-01");
      expect(detail.categories[0]!.goalTarget).toBeUndefined();
    });

    it("a note fetch that fails for a reason that isn't transient fails the call: a goal left out would read as unset", async () => {
      mockFetch.mockReturnValueOnce(
        jsonResponse({
          data: {
            month: "2026-01",
            totalIncome: 0,
            totalBudgeted: 0,
            totalSpent: 0,
            toBudget: 0,
            categoryGroups: [
              {
                id: "g1",
                name: "Bills",
                is_income: false,
                hidden: false,
                categories: [
                  {
                    id: "c1",
                    name: "Rent",
                    group_id: "g1",
                    hidden: false,
                    goal: 30000,
                  },
                ],
              },
            ],
          },
        }),
      );
      // A missing note is a 200 with `data: ""` (the wrapper's route), so a
      // 404 is a real error.
      mockFetch.mockReturnValueOnce(jsonResponse({ error: "not found" }, 404));
      await expect(client.getMonthDetail("2026-01")).rejects.toMatchObject({
        code: "client",
      });
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

    it("a split keeps its own category and carries its live parts", async () => {
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
          ],
        }),
      );
      mockFetch.mockReturnValueOnce(
        jsonResponse({
          data: [
            {
              id: "tx-2",
              account: "a1",
              date: "2026-02-05",
              amount: -14010,
              category: "utilities",
              cleared: true,
              reconciled: false,
              subtransactions: [
                { amount: -9010, category: "water", notes: null },
                { amount: -5000, category: "trash", notes: "trash" },
                { amount: -100, category: "x", tombstone: true },
              ],
            },
          ],
        }),
      );
      const [tx] = await client.getTransactions("2026-01-01");
      expect(tx!.categoryId).toBe("utilities");
      expect(tx!.subtransactions).toEqual([
        { categoryId: "water", categoryName: null, amount: -90.1, memo: null },
        { categoryId: "trash", categoryName: null, amount: -50, memo: "trash" },
      ]);
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

  describe("cold wrapper gate", () => {
    const noBudget = () =>
      jsonResponse({ error: "No budget file is open" }, 404);

    it("runs the first request to a cold wrapper alone", async () => {
      let releaseFirst!: () => void;
      mockFetch.mockReturnValueOnce(
        new Promise((resolve) => {
          releaseFirst = () => resolve(jsonResponse({ data: 100 }));
        }),
      );
      mockFetch.mockReturnValueOnce(jsonResponse({ data: 200 }));

      const first = client.getAccountBalance("a1");
      const second = client.getAccountBalance("a2");
      await new Promise((r) => setTimeout(r, 0));
      expect(mockFetch).toHaveBeenCalledTimes(1);

      releaseFirst();
      expect(await first).toBe(1);
      expect(await second).toBe(2);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("lets requests run concurrently once the wrapper is warm", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ data: 0 }));
      await client.getAccountBalance("warm");

      mockFetch.mockReturnValue(new Promise(() => {}));
      void client.getAccountBalance("a1");
      void client.getAccountBalance("a2");
      await new Promise((r) => setTimeout(r, 0));
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("fails waiters with the first request's load failure", async () => {
      mockFetch.mockReturnValueOnce(noBudget());

      const results = await Promise.allSettled([
        client.getAccountBalance("a1"),
        client.getAccountBalance("a2"),
      ]);
      expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("goes cold and retries once when a warm wrapper loses its budget", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ data: 0 }));
      await client.getAccountBalance("warm");

      mockFetch.mockReturnValueOnce(noBudget());
      mockFetch.mockReturnValueOnce(jsonResponse({ data: 500 }));
      expect(await client.getAccountBalance("a1")).toBe(5);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("a write that may have been applied is not sent again; the wrapper goes cold", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ data: 0 }));
      await client.getAccountBalance("warm");

      // A POST hitting a server error: it may have been applied.
      mockFetch.mockReturnValueOnce(jsonResponse({ error: "boom" }, 500));
      await expect(
        client.createTransaction({
          accountId: "a1",
          date: "2026-01-15",
          amount: -10,
          payeeName: "x",
          categoryId: null,
          memo: null,
          cleared: false,
          reconciled: false,
        } as never),
      ).rejects.toThrow();
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Cold now: the next request runs alone.
      let release!: () => void;
      mockFetch.mockReturnValueOnce(
        new Promise((resolve) => {
          release = () => resolve(jsonResponse({ data: 100 }));
        }),
      );
      mockFetch.mockReturnValueOnce(jsonResponse({ data: 200 }));
      const first = client.getAccountBalance("a1");
      const second = client.getAccountBalance("a2");
      await new Promise((r) => setTimeout(r, 0));
      expect(mockFetch).toHaveBeenCalledTimes(3);
      release();
      await Promise.all([first, second]);
    });

    it("a write the wrapper says never ran is sent again", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ data: 0 }));
      await client.getAccountBalance("warm");

      mockFetch.mockReturnValueOnce(noBudget());
      mockFetch.mockReturnValueOnce(jsonResponse({ data: "ok" }));
      await client.deleteTransaction("tx-1");
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(mockFetch.mock.calls[2]![1].method).toBe("DELETE");
    });

    it("does not retry an ordinary client error", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ data: 0 }));
      await client.getAccountBalance("warm");

      mockFetch.mockReturnValueOnce(jsonResponse({ error: "bad id" }, 400));
      await expect(client.getAccountBalance("bad")).rejects.toThrow(/400/);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("treats a cold wrapper's ordinary client error as loaded", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ error: "bad id" }, 400));
      await expect(client.getAccountBalance("bad")).rejects.toThrow(/400/);

      mockFetch.mockReturnValue(new Promise(() => {}));
      void client.getAccountBalance("a1");
      void client.getAccountBalance("a2");
      await new Promise((r) => setTimeout(r, 0));
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe("URL construction", () => {
    it("strips trailing slash from server URL", () => {
      const c = new ActualClient("http://actual.local/", "key", "sync-id");
      mockFetch.mockReturnValueOnce(jsonResponse({ data: [] }));
      c.testConnection();
      const url = mockFetch.mock.calls[0]![0];
      expect(url).not.toContain("//v1");
    });
  });
});

describe("ActualClient with dates after the wrapper's today", () => {
  // A stand-in that behaves as the real wrapper does (actual-http-api
  // 26.10.0): a transaction list ends at the wrapper's own today unless
  // until_date is sent, and a balance counts every transaction up to
  // cutoff_date (inclusive) or, without it, up to that today.
  const WRAPPER_TODAY = "2026-11-02";
  type Row = {
    id: string;
    account: string;
    date: string;
    amount: number;
    imported_id?: string;
  };
  let rows: Row[];
  let client: ActualClient;

  beforeEach(() => {
    mockFetch.mockReset();
    resetActualWrapperGates();
    rows = [
      {
        id: "opening",
        account: "acct-1",
        date: "2026-10-01",
        amount: 5_000_000,
      },
      { id: "later", account: "acct-1", date: "2026-11-03", amount: -333 },
    ];
    client = new ActualClient(
      "http://actual.local",
      "test-api-key",
      "sync-id-123",
    );
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      const u = new URL(url);
      const m = u.pathname.match(
        /\/accounts\/([^/]+)\/(transactions|balance)$/,
      );
      if (m?.[2] === "transactions" && init?.method === "POST") {
        const t = JSON.parse(init.body as string).transaction;
        rows.push({
          id: `tx-${rows.length}`,
          account: m[1]!,
          date: t.date,
          amount: t.amount,
          imported_id: t.imported_id,
        });
        return jsonResponse({ message: "ok" });
      }
      if (m?.[2] === "transactions") {
        const since = u.searchParams.get("since_date")!;
        const until = u.searchParams.get("until_date") ?? WRAPPER_TODAY;
        return jsonResponse({
          data: rows
            .filter(
              (r) => r.account === m[1] && r.date >= since && r.date <= until,
            )
            .map((r) => ({ ...r, cleared: true, reconciled: false })),
        });
      }
      if (m?.[2] === "balance") {
        const cutoff = u.searchParams.get("cutoff_date") ?? WRAPPER_TODAY;
        return jsonResponse({
          data: rows
            .filter((r) => r.account === m[1] && r.date <= cutoff)
            .reduce((s, r) => s + r.amount, 0),
        });
      }
      if (u.pathname.endsWith("/accounts"))
        return jsonResponse({
          data: [
            { id: "acct-1", name: "Roth", offbudget: true, closed: false },
          ],
        });
      throw new Error(`unexpected ${init?.method ?? "GET"} ${u.pathname}`);
    });
  });

  it("finds back a transaction it wrote dated after the wrapper's today", async () => {
    // A snapshot ahead of the wrapper's clock: the read-back used to miss
    // it, report a failure with the adjustment posted, and post again on
    // every retry.
    const id = await client.createTransaction({
      importKey: "push-1",
      accountId: "acct-1",
      date: "2026-12-15",
      amount: 10_000,
      payeeName: "Portfolio Sync",
      memo: "snapshot:7",
      cleared: true,
    });
    expect(id).toBe("tx-2");
  });

  it("lists transactions dated after the wrapper's today", async () => {
    const own = await client.getAccountTransactions("acct-1", "2026-01-01");
    expect(own.map((t) => t.id)).toEqual(["opening", "later"]);
    const all = await client.getTransactions("2026-01-01");
    expect(all.map((t) => t.id)).toEqual(["opening", "later"]);
  });

  it("reads a balance as of a date, whatever the wrapper's today is", async () => {
    expect(await client.getAccountBalance("acct-1", "2026-11-02")).toBe(50_000);
    expect(await client.getAccountBalance("acct-1", "2026-11-03")).toBe(
      49_996.67,
    );
    // Without a date: up to the wrapper's today.
    expect(await client.getAccountBalance("acct-1")).toBe(50_000);
  });
});
