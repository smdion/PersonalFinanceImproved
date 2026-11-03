/* eslint-disable @typescript-eslint/no-explicit-any -- the tests reshape recorded JSON */
/**
 * Actual's response schemas against what the real wrapper sends
 * (tests/fixtures/actual-wrapper, recorded from actual-http-api 26.10.0),
 * and against the broken shapes the sync test fed it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { actualSchemas } from "@/lib/budget-api/actual-schemas";
import {
  ActualClient,
  resetActualWrapperGates,
} from "@/lib/budget-api/actual-client";
import { parseExternal } from "@/lib/http/external-request";
import { z } from "zod/v4";

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

type Fixture = { bodies: unknown[] };
function recorded(name: string): unknown[] {
  const file = path.resolve("tests/fixtures/actual-wrapper", `${name}.json`);
  return (JSON.parse(fs.readFileSync(file, "utf8")) as Fixture).bodies;
}

const clone = <T>(v: T): T => structuredClone(v);
const month = () => clone(recorded("month")[0]) as any;
const accounts = () => clone(recorded("accounts")[0]) as any;
const transactions = () =>
  clone(recorded("transactions").find((b: any) => b.data.length > 0)) as any;

describe("every recorded wrapper response passes its schema", () => {
  it.each([
    ["accounts", actualSchemas.accounts],
    ["balance", actualSchemas.balance],
    ["transactions", actualSchemas.transactions],
    ["categories", actualSchemas.categories],
    ["category-groups", actualSchemas.categoryGroups],
    ["month-ids", actualSchemas.monthIds],
    ["month", actualSchemas.month],
    ["note", actualSchemas.note],
  ] as const)("%s", (name, schema) => {
    const bodies = recorded(name);
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies)
      expect(schema.safeParse(body).error).toBe(undefined);
  });

  it("they include the edge cases: an income group, a closed account, a split, an empty note", () => {
    const groups = month().data.categoryGroups as any[];
    expect(groups.some((g) => g.is_income)).toBe(true);
    expect(accounts().data.some((a: any) => a.closed)).toBe(true);
    expect(
      recorded("transactions").some((b: any) =>
        b.data.some((t: any) => t.subtransactions?.length > 0),
      ),
    ).toBe(true);
    expect(recorded("note")).toContainEqual({ data: "" });
  });
});

describe("ActualClient on recorded and broken responses", () => {
  let client: ActualClient;
  beforeEach(() => {
    mockFetch.mockReset();
    resetActualWrapperGates();
    client = new ActualClient("http://actual.local", "key", "sync-id");
  });

  it("reads a recorded month: income categories have no budgeted, spent or balance", async () => {
    mockFetch.mockImplementation((url: string) =>
      url.includes("/notes/")
        ? jsonResponse({ data: "" })
        : jsonResponse(month()),
    );
    const detail = await client.getMonthDetail("2026-11-01");
    const salary = detail.categories.find((c) => c.name === "Test Salary")!;
    expect(salary).toMatchObject({ budgeted: 0, activity: 0, balance: 0 });
    expect(detail.categories.every((c) => Number.isFinite(c.balance))).toBe(
      true,
    );
  });

  it("reads a tracking budget's month: no to-budget, income categories with budgeted and balance", async () => {
    const body = month();
    body.data.toBudget = null;
    for (const g of body.data.categoryGroups)
      if (g.is_income)
        for (const c of g.categories)
          Object.assign(c, { budgeted: 0, balance: 0, carryover: false });
    mockFetch.mockImplementation((url: string) =>
      url.includes("/notes/") ? jsonResponse({ data: "" }) : jsonResponse(body),
    );
    const detail = await client.getMonthDetail("2026-11-01");
    expect(detail.toBeBudgeted).toBeNull();
    expect(detail.categories.length).toBeGreaterThan(0);
  });

  it("an answer that isn't JSON is bad-response, fetched once", async () => {
    mockFetch.mockReturnValue(
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve("<html>Sign in</html>"),
        json: () => Promise.reject(new SyntaxError("Unexpected token <")),
      }),
    );
    await expect(client.getAccounts()).rejects.toMatchObject({
      code: "bad-response",
      message: "Actual: /accounts: not JSON",
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("a note without a string is bad-response: a merge would drop the note's text", async () => {
    mockFetch.mockReturnValue(jsonResponse({ data: null }));
    await expect(
      client.prepareGoalWrite("c1", "monthly", 100),
    ).rejects.toMatchObject({ code: "bad-response" });
  });

  it("reads recorded accounts with their balances", async () => {
    mockFetch.mockImplementation((url: string) =>
      url.includes("/balance")
        ? jsonResponse({ data: 1234567 })
        : jsonResponse(accounts()),
    );
    const list = await client.getAccounts();
    expect(list).toHaveLength(9);
    expect(list.every((a) => a.balance === 12345.67)).toBe(true);
  });

  /** Each shape the sync test fed the old client, which stored it with
   *  `success: true`. Each now fails as bad-response, fetched once. */
  it.each([
    [
      "a nested balance",
      { data: { balance: 35000033 } },
      "data: expected number, received object",
    ],
    [
      "a string balance",
      { data: "350000.33" },
      "data: expected number, received string",
    ],
    ["no balance", { data: null }, "data: expected number, received null"],
    [
      "a fractional balance",
      { data: 3500.0033 },
      "data: expected int, received number",
    ],
  ])("balance: %s", async (_name, body, field) => {
    mockFetch.mockReturnValue(jsonResponse(body));
    await expect(
      client.getAccountBalance("3d5331c8-2fbb-4217-99d0-237b9a3bb321"),
    ).rejects.toMatchObject({
      code: "bad-response",
      message: `Actual: /accounts/:id/balance: ${field}`,
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "a renamed category balance",
      (m: any) => {
        const c = m.data.categoryGroups[0].categories[0];
        c.bal = c.balance;
        delete c.balance;
      },
      "data.categoryGroups.0.categories.0.balance",
    ],
    [
      "a renamed category spent",
      (m: any) => {
        delete m.data.categoryGroups[0].categories[0].spent;
      },
      "data.categoryGroups.0.categories.0.spent",
    ],
    [
      "renamed categoryGroups",
      (m: any) => {
        m.data.groups = m.data.categoryGroups;
        delete m.data.categoryGroups;
      },
      "data.categoryGroups",
    ],
    [
      "a renamed total",
      (m: any) => {
        delete m.data.totalIncome;
      },
      "data.totalIncome",
    ],
  ])("month: %s", async (_name, breakIt, field) => {
    const body = month();
    breakIt(body);
    mockFetch.mockReturnValue(jsonResponse(body));
    await expect(client.getMonthDetail("2026-11-01")).rejects.toMatchObject({
      code: "bad-response",
      message: expect.stringContaining(`Actual: /months/2026-11: ${field}:`),
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["amount", "data.0.amount"],
    ["date", "data.0.date"],
    ["subtransactions", "data.0.subtransactions"],
  ])("transactions: a renamed %s", async (key, field) => {
    const body = transactions();
    body.data[0][`${key}_x`] = body.data[0][key];
    delete body.data[0][key];
    mockFetch.mockReturnValue(jsonResponse(body));
    await expect(
      client.getAccountTransactions("acct", "2026-01-01"),
    ).rejects.toMatchObject({
      code: "bad-response",
      message: expect.stringContaining(`${field}:`),
    });
  });

  it("a field missing from every item is reported once, with how many more", async () => {
    const body = transactions();
    for (const t of body.data) delete t.amount;
    mockFetch.mockReturnValue(jsonResponse(body));
    await expect(
      client.getAccountTransactions("acct", "2026-01-01"),
    ).rejects.toThrow(
      `data.0.amount: expected number, received undefined (+${body.data.length - 1} more)`,
    );
  });

  it("accounts: a renamed offbudget", async () => {
    const body = accounts();
    for (const a of body.data) {
      a.off_budget = a.offbudget;
      delete a.offbudget;
    }
    mockFetch.mockReturnValue(jsonResponse(body));
    await expect(client.getAccounts()).rejects.toMatchObject({
      code: "bad-response",
      message: expect.stringContaining("Actual: /accounts: data.0.offbudget:"),
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("parseExternal", () => {
  const schema = z.object({ data: z.number() });

  it("returns what the schema gives", () => {
    expect(
      parseExternal(schema, { data: 1 }, { service: "ynab", endpoint: "/x" }),
    ).toEqual({ data: 1 });
  });

  it("names the service, the endpoint as a pattern and at most three fields", () => {
    const many = z.object({
      a: z.number(),
      b: z.number(),
      c: z.number(),
      d: z.number(),
    });
    expect(() =>
      parseExternal(
        many,
        {},
        {
          service: "simplefin",
          endpoint:
            "/accounts/0E1F5BDB-209B-43F9-AF2C-3CE28E380C00/x?start=1&key=secret",
        },
      ),
    ).toThrow(
      /^SimpleFIN: \/accounts\/:id\/x: a: expected number, received undefined; b: [^;]+; c: [^;]+$/,
    );
  });
});
