/* eslint-disable @typescript-eslint/no-explicit-any -- the tests reshape fixture JSON */
/**
 * YNAB's response schemas against the spec-built fixtures (YNAB API spec
 * 1.88.0, `/budgets` field names) and against the broken shapes the sync
 * test fed the Actual client: YNAB is held to the same failures.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ynabSchemas } from "@/lib/budget-api/ynab-schemas";
import { YnabClient } from "@/lib/budget-api/ynab-client";
import {
  ynabAccount,
  ynabCategory,
  ynabMonth,
  ynabTransaction,
} from "../fixtures/ynab-spec";

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

const accounts = () => ({
  data: {
    accounts: [
      ynabAccount(),
      ynabAccount({
        id: "acct-2",
        closed: true,
        deleted: true,
        transfer_payee_id: null,
      }),
    ],
    server_knowledge: 10,
  },
});
const month = () => ({
  data: {
    month: ynabMonth({
      categories: [
        ynabCategory({ category_group_name: "Bills" }),
        ynabCategory({
          id: "cat-2",
          category_group_name: "Savings",
          goal_type: "TB",
          goal_target: 5_000_000,
          goal_cadence: 0,
        }),
      ],
    }),
  },
});
const transactions = () => ({
  data: {
    transactions: [
      ynabTransaction(),
      ynabTransaction({
        id: "tx-split",
        category_name: "Split",
        subtransactions: [
          {
            id: "s1",
            transaction_id: "tx-split",
            amount: -10000,
            memo: null,
            payee_id: null,
            payee_name: null,
            category_id: "cat-1",
            category_name: "Rent",
            transfer_account_id: null,
            transfer_transaction_id: null,
            deleted: false,
          },
          {
            id: "s2",
            transaction_id: "tx-split",
            amount: -15000,
            memo: null,
            payee_id: null,
            payee_name: null,
            category_id: null,
            category_name: null,
            transfer_account_id: null,
            transfer_transaction_id: null,
            deleted: true,
          },
        ],
      }),
      ynabTransaction({ id: "tx-gone", deleted: true }),
    ],
    server_knowledge: 10,
  },
});

describe("every spec-built response passes its schema", () => {
  it.each([
    [
      "budgets",
      ynabSchemas.budgets,
      {
        data: {
          budgets: [{ id: "b1", name: "Home" }],
          default_budget: null,
        },
      },
    ],
    ["accounts", ynabSchemas.accounts, accounts()],
    ["account", ynabSchemas.account, { data: { account: ynabAccount() } }],
    [
      "categories",
      ynabSchemas.categories,
      {
        data: {
          category_groups: [
            {
              id: "g1",
              name: "Bills",
              hidden: false,
              internal: false,
              deleted: false,
              categories: [ynabCategory()],
            },
          ],
          server_knowledge: 10,
        },
      },
    ],
    ["category", ynabSchemas.category, { data: { category: ynabCategory() } }],
    [
      "months",
      ynabSchemas.months,
      {
        data: {
          months: [ynabMonth({ categories: undefined })],
          server_knowledge: 10,
        },
      },
    ],
    ["month", ynabSchemas.month, month()],
    ["transactions", ynabSchemas.transactions, transactions()],
    [
      "created",
      ynabSchemas.created,
      {
        data: {
          transaction_ids: ["t1"],
          transaction: ynabTransaction(),
          server_knowledge: 11,
        },
      },
    ],
    [
      "created, a duplicate",
      ynabSchemas.created,
      {
        data: {
          transaction_ids: [],
          duplicate_import_ids: ["ledgr:x"],
          server_knowledge: 11,
        },
      },
    ],
  ] as const)("%s", (_name, schema, body) => {
    expect(schema.safeParse(body).error).toBe(undefined);
  });
});

describe("YnabClient on broken responses", () => {
  let client: YnabClient;
  beforeEach(() => {
    mockFetch.mockReset();
    client = new YnabClient("token", "budget-1");
  });

  it.each([
    [
      "a nested balance",
      { balance: { amount: 1 } },
      "expected number, received object",
    ],
    [
      "a string balance",
      { balance: "350000330" },
      "expected number, received string",
    ],
    ["no balance", { balance: null }, "expected number, received null"],
    [
      "a fractional balance",
      { balance: 3500.0033 },
      "expected int, received number",
    ],
  ])("account: %s", async (_name, change, problem) => {
    mockFetch.mockReturnValue(
      jsonResponse({ data: { account: ynabAccount(change) } }),
    );
    await expect(client.getAccountBalance("acct-1")).rejects.toMatchObject({
      code: "bad-response",
      message: `YNAB: /accounts/acct-1: data.account.balance: ${problem}`,
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("an account answer of {data: null} is bad-response", async () => {
    mockFetch.mockReturnValue(jsonResponse({ data: null }));
    await expect(client.getAccountBalance("acct-1")).rejects.toMatchObject({
      code: "bad-response",
    });
  });

  it.each([
    [
      "a renamed category balance",
      (m: any) => {
        const c = m.data.month.categories[0];
        c.bal = c.balance;
        delete c.balance;
      },
      "data.month.categories.0.balance",
    ],
    [
      "a renamed category activity",
      (m: any) => {
        delete m.data.month.categories[0].activity;
      },
      "data.month.categories.0.activity",
    ],
    [
      "renamed categories",
      (m: any) => {
        m.data.month.cats = m.data.month.categories;
        delete m.data.month.categories;
      },
      "data.month.categories",
    ],
    [
      "a renamed total",
      (m: any) => {
        delete m.data.month.income;
      },
      "data.month.income",
    ],
  ])("month: %s", async (_name, breakIt, field) => {
    const body = month();
    breakIt(body);
    mockFetch.mockReturnValue(jsonResponse(body));
    await expect(client.getMonthDetail("2026-01-01")).rejects.toMatchObject({
      code: "bad-response",
      message: expect.stringContaining(`YNAB: /months/2026-01-01: ${field}:`),
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["amount", "data.transactions.0.amount"],
    ["date", "data.transactions.0.date"],
    ["subtransactions", "data.transactions.0.subtransactions"],
  ])("transactions: a renamed %s", async (key, field) => {
    const body: any = transactions();
    body.data.transactions[0][`${key}_x`] = body.data.transactions[0][key];
    delete body.data.transactions[0][key];
    mockFetch.mockReturnValue(jsonResponse(body));
    await expect(
      client.getAccountTransactions("acct-1", "2026-01-01"),
    ).rejects.toMatchObject({
      code: "bad-response",
      message: expect.stringContaining(`${field}:`),
    });
  });

  it("accounts: a renamed on_budget", async () => {
    const body: any = accounts();
    for (const a of body.data.accounts) {
      a.onbudget = a.on_budget;
      delete a.on_budget;
    }
    mockFetch.mockReturnValue(jsonResponse(body));
    await expect(client.getAccounts()).rejects.toMatchObject({
      code: "bad-response",
      message: expect.stringContaining(
        "YNAB: /accounts: data.accounts.0.on_budget:",
      ),
    });
  });

  it("a goal read that doesn't fit is bad-response, not a conflict, and nothing is written", async () => {
    mockFetch.mockReturnValue(
      jsonResponse({ data: { category: ynabCategory({ budgeted: "0" }) } }),
    );
    await expect(
      client.prepareGoalWrite("cat-1", "monthly", 100),
    ).rejects.toMatchObject({ code: "bad-response" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
