/**
 * Every BudgetAPIClient member, run for every BUDGET_PROVIDERS entry, so a
 * provider added to the registry gets the same checks.
 *
 * Actual answers are the wrapper's own, recorded in
 * tests/fixtures/actual-recorded/ (actual-http-api 26.10.0 @ 8ef9a0ca, an
 * invented throwaway budget; index.json lists the ids). Re-record them on
 * each wrapper bump and run this file against the new set. The recording
 * predates two things Ledgr sends now: `until_date` on transaction lists
 * (ignored when matching a request to its recording) and the `/payees`
 * read, which is answered with an empty list until the next recording.
 *
 * YNAB can't be recorded: its answers are built from its published spec
 * 1.88.0 (tests/fixtures/ynab-spec.ts), and its failures (rate limits, a
 * server_knowledge reset, a deleted category) in tests/fixtures/ynab-failures/,
 * the counterpart of the Actual recordings.
 *
 * Known wrapper defects are `it.fails`, each naming its v0.11 item.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BudgetAPIClient } from "@/lib/budget-api/interface";
import type {
  BudgetTransaction,
  NewBudgetTransaction,
} from "@/lib/budget-api/types";
import "../routers/test-encryption-key";
import { encryptJson } from "@/lib/crypto";
import { BUDGET_PROVIDERS } from "@/lib/budget-api/providers";
import { resetActualWrapperGates } from "@/lib/budget-api/actual-client";
import { BudgetApiError } from "@/lib/budget-api/errors";
import {
  BUDGET_API_SERVICE_VALUES,
  type BudgetApiService,
} from "@/lib/config/budget-apps";
import {
  ynabAccount,
  ynabCategory,
  ynabMonth,
  ynabTransaction,
} from "../fixtures/ynab-spec";

/** One request and its answer, as the recordings hold them. */
type Pair = {
  name?: string;
  method: string;
  path: string;
  requestBody: unknown;
  status: number;
  responseBody: unknown;
};
type Sent = { method: string; path: string; body: unknown };

const RECORDED = path.resolve("tests/fixtures/actual-recorded");

function recording(file: string): Pair[] {
  const raw = fs.readFileSync(path.join(RECORDED, `${file}.json`), "utf8");
  return (JSON.parse(raw) as { pairs: Pair[] }).pairs;
}

const YNAB_FAILURES = path.resolve("tests/fixtures/ynab-failures");

/** A YNAB failure, built from the spec (tests/fixtures/ynab-failures/). */
function ynabFailure(file: string): Pair[] {
  const raw = fs.readFileSync(path.join(YNAB_FAILURES, `${file}.json`), "utf8");
  return (JSON.parse(raw) as { pairs: Pair[] }).pairs;
}

/** A call whose retries wait on the backoff timer, run to its end: its
 *  value, or its rejection as a value. */
async function withRetries(p: Promise<unknown>): Promise<unknown> {
  const settled = p.then(
    (v) => v,
    (e: unknown) => e,
  );
  await vi.runAllTimersAsync();
  return settled;
}

/** One named pair of endpoints.json. */
function endpoint(name: string): Pair {
  const pair = recording("endpoints").find((p) => p.name === name);
  if (!pair) throw new Error(`endpoints.json has no pair named ${name}`);
  return pair;
}

const ACTUAL_IDS = JSON.parse(
  fs.readFileSync(path.join(RECORDED, "index.json"), "utf8"),
).ids as {
  syncId: string;
  accounts: Record<
    "chk" | "sav" | "visa" | "old" | "brk" | "roth" | "mtg" | "house" | "gone",
    string
  >;
  categories: Record<
    "groc" | "dine" | "gas" | "misc" | "ef" | "vac" | "car" | "hid" | "sal",
    string
  >;
};
const ACTUAL_SERVER = "http://actual.test";

/** A request's path with `until_date` dropped: the recordings predate it. */
function matchKey(method: string, p: string): string {
  const [base, query = ""] = p.split("?");
  const params = new URLSearchParams(query);
  params.delete("until_date");
  const q = params.toString();
  return `${method} ${base}${q ? `?${q}` : ""}`;
}

/**
 * A fake service. Each request is answered by the first pair for its method
 * and path not yet used (the last one again once all are used); a request
 * with no pair is recorded in `unanswered` and gets a 599.
 */
function fakeService(prefix: string, pairs: Pair[], echo?: string) {
  const sent: Sent[] = [];
  const unanswered: string[] = [];
  const used = new Set<Pair>();
  let posted: string | undefined;
  const fetchFn = async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const p = url.startsWith(prefix) ? url.slice(prefix.length) : url;
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    sent.push({ method, path: p, body });
    posted = body?.transaction?.imported_id ?? posted;
    const key = matchKey(method, p);
    const matches = pairs.filter((x) => matchKey(x.method, x.path) === key);
    const pair = matches.find((x) => !used.has(x)) ?? matches.at(-1);
    if (!pair) {
      unanswered.push(key);
      return new Response(JSON.stringify({ error: "unanswered" }), {
        status: 599,
      });
    }
    used.add(pair);
    const text = JSON.stringify(pair.responseBody);
    return new Response(echo && posted ? text.replaceAll(echo, posted) : text, {
      status: pair.status,
    });
  };
  return { sent, unanswered, fetchFn };
}

/** A member's check: the answers it gets, the call, what must hold. */
type Case = {
  answers: Pair[];
  run: (client: BudgetAPIClient) => Promise<unknown>;
  check: (result: unknown, sent: Sent[]) => void;
  /** A recorded imported_id the answers carry as the one this run posted. */
  echo?: string;
};

type World = {
  config: Record<string, string>;
  /** Stripped from each request URL to give the pair's path. */
  prefix: string;
  cases: { [M in keyof BudgetAPIClient]: Case[] };
  /** Recorded defects: each test fails today, named for its v0.11 item. */
  defects: Partial<Record<"months" | "patchDate" | "rejectedOnce", Case>>;
};

const ok = (method: string, p: string, responseBody: unknown): Pair => ({
  method,
  path: p,
  requestBody: null,
  status: 200,
  responseBody,
});

/** A rejection as a value, so `check` can read it. */
const settle = (p: Promise<unknown>) =>
  p.then(
    () => "resolved",
    (e: unknown) => e,
  );

const tx = (
  overrides: Partial<NewBudgetTransaction>,
): NewBudgetTransaction => ({
  importKey: "conformance-1",
  accountId: "acct-1",
  date: "2026-10-03",
  amount: -19.99,
  payeeName: "Dup",
  memo: "same fingerprint 626787",
  cleared: true,
  ...overrides,
});

// ── Actual: the recorded wrapper ──

const A = ACTUAL_IDS.accounts;
const C = ACTUAL_IDS.categories;
const syncAll = recording("sync-all");
/** Recorded before Ledgr read `/payees`. */
const NO_PAYEES = ok("GET", "/payees", { data: [] });

const actual: World = {
  config: {
    serverUrl: ACTUAL_SERVER,
    apiKey: "conformance-key",
    budgetSyncId: ACTUAL_IDS.syncId,
  },
  prefix: `${ACTUAL_SERVER}/v1/budgets/${ACTUAL_IDS.syncId}`,
  cases: {
    testConnection: [
      {
        answers: [endpoint("accounts")],
        run: (c) => c.testConnection(),
        check: (r) => expect(r).toBeUndefined(),
      },
      {
        answers: [endpoint("wrong-api-key")],
        run: (c) => settle(c.testConnection()),
        check: (r) => expect(r).toMatchObject({ code: "auth" }),
      },
    ],
    getBudgetName: [
      {
        answers: [],
        run: (c) => c.getBudgetName(),
        check: (r) =>
          expect(r).toBe(`Actual (${ACTUAL_IDS.syncId.slice(0, 8)}...)`),
      },
    ],
    getAccounts: [
      {
        answers: syncAll,
        run: (c) => c.getAccounts(),
        check: (r) => {
          const byId = new Map(
            (r as { id: string; balance: number; closed: boolean }[]).map(
              (a) => [a.id, a],
            ),
          );
          expect(byId.size).toBe(9);
          expect(byId.get(A.chk)).toMatchObject({
            name: "Test Checking",
            onBudget: true,
            balance: 14061.79,
            clearedBalance: 14061.79,
          });
          expect(byId.get(A.mtg)).toMatchObject({
            onBudget: false,
            balance: -250000.75,
          });
          expect(byId.get(A.old)).toMatchObject({ closed: true, balance: 0 });
          expect(byId.get(A.gone)?.balance).toBe(1.2);
        },
      },
    ],
    getAccountBalance: [
      {
        answers: [endpoint("balance-checking")],
        run: (c) => c.getAccountBalance(A.chk),
        check: (r) => expect(r).toBe(14061.79),
      },
      {
        answers: [endpoint("balance-offbudget-debt")],
        run: (c) => c.getAccountBalance(A.mtg),
        check: (r) => expect(r).toBe(-250000.75),
      },
    ],
    getCategories: [
      {
        answers: syncAll,
        run: (c) => c.getCategories(new Date()),
        check: (r) => {
          const groups = r as Awaited<
            ReturnType<BudgetAPIClient["getCategories"]>
          >;
          expect(groups.map((g) => g.name)).toEqual([
            "Usual Expenses",
            "Investments and Savings",
            "Test Expenses",
            "Test Sinking Funds",
            "Test Hidden Group",
            "Income",
          ]);
          const income = groups.find((g) => g.name === "Income");
          expect(income).toMatchObject({ isIncome: true, hidden: true });
          const cats = new Map(
            groups.flatMap((g) => g.categories).map((x) => [x.id, x]),
          );
          for (const g of groups)
            for (const x of g.categories) expect(x.groupId).toBe(g.id);
          // This month's numbers and each note's goal.
          expect(cats.get(C.groc)).toMatchObject({
            budgeted: 400,
            activity: 15.24,
            balance: 1093.73,
            goalTarget: 400,
          });
          expect(cats.get(C.dine)?.goalTarget).toBe(150.5);
          expect(cats.get(C.ef)?.goalTarget).toBe(5000);
          // A combined or priority template is no goal Ledgr reads.
          expect(cats.get(C.car)?.goalTarget).toBeUndefined();
          expect(cats.get(C.vac)?.goalTarget).toBeUndefined();
        },
      },
    ],
    getMonths: [
      {
        // Actual's own month ids; YYYY-MM-01 bounds are a defect below.
        answers: [endpoint("months"), ...syncAll],
        run: (c) => c.getMonths("2026-11", "2026-11"),
        check: (r) =>
          expect(r).toEqual([
            {
              month: "2026-11",
              income: 0,
              budgeted: 1758.95,
              activity: -232.53,
              toBeBudgeted: 10679.49,
            },
          ]),
      },
    ],
    getMonthDetail: [
      {
        answers: syncAll,
        run: (c) => c.getMonthDetail("2026-11-01"),
        check: (r, sent) => {
          const m = r as Awaited<ReturnType<BudgetAPIClient["getMonthDetail"]>>;
          expect(m).toMatchObject({ month: "2026-11", budgeted: 1758.95 });
          expect(m.categories).toHaveLength(16);
          expect(sent[0]?.path).toBe("/months/2026-11");
        },
      },
    ],
    updateCategoryBudgeted: [
      {
        answers: [endpoint("patch-budgeted")],
        run: (c) => c.updateCategoryBudgeted("2026-12-01", C.car, 43.21),
        check: (r, sent) => {
          expect(r).toBeUndefined();
          expect(sent).toEqual([
            {
              method: "PATCH",
              path: endpoint("patch-budgeted").path,
              body: endpoint("patch-budgeted").requestBody,
            },
          ]);
        },
      },
    ],
    prepareGoalWrite: [
      {
        answers: recording("budget-push-with-orphan-link"),
        run: async (c) => {
          const write = await c.prepareGoalWrite(C.gas, "monthly", 75.25);
          await write.apply();
        },
        check: (_r, sent) => {
          const put = recording("budget-push-with-orphan-link").find(
            (p) => p.method === "PUT" && p.path.endsWith(C.gas),
          );
          expect(sent.filter((s) => s.method === "PUT")).toEqual([
            { method: "PUT", path: put?.path, body: put?.requestBody },
          ]);
        },
      },
      {
        answers: [endpoint("note-conflicting-template")],
        run: (c) => settle(c.prepareGoalWrite(C.car, "monthly", 100)),
        check: (r, sent) => {
          expect(r).toBeInstanceOf(BudgetApiError);
          expect((r as BudgetApiError).code).toBe("conflict");
          expect(sent.every((s) => s.method === "GET")).toBe(true);
        },
      },
    ],
    getTransactions: [
      {
        answers: [...syncAll, NO_PAYEES],
        run: (c) => c.getTransactions("2025-01-01"),
        check: (r) => {
          const list = r as Awaited<
            ReturnType<BudgetAPIClient["getTransactions"]>
          >;
          // Eight open accounts' lists; the closed one isn't read.
          expect(list).toHaveLength(30);
          expect(list.some((t) => t.accountId === A.old)).toBe(false);
          const split = list.find((t) => t.memo === "split D thirds");
          expect(split).toMatchObject({
            accountName: "Test Checking",
            amount: -99.99,
            cleared: true,
          });
          expect(split?.subtransactions?.map((s) => s.categoryName)).toEqual([
            "Test Gas Utility",
            "Test Dining",
            "Test Vacation",
          ]);
          expect(list.find((t) => t.memo === "refund")).toMatchObject({
            amount: 15.25,
            categoryName: "Test Groceries",
          });
        },
      },
    ],
    createTransaction: [
      {
        // The wrapper stores the imported_id it's sent; the recording's came
        // from a random import key, so the read-back carries this POST's.
        answers: recording("create-transaction-twice").slice(0, 2),
        echo: "ledgr:BGYuJng_unvJn9VDR6Pkv-n1tRH-X8",
        run: (c) => c.createTransaction(tx({ accountId: A.gone })),
        check: (r, sent) => {
          expect(r).toBe("1201d6e8-ce6a-4d45-af76-e47079622402");
          const recorded = recording("create-transaction-twice")[0]!;
          const posted = sent[0]!.body as {
            transaction: Record<string, unknown>;
          };
          const { imported_id: _sent, ...rest } = posted.transaction;
          const { imported_id: _rec, ...recordedRest } = (
            recorded.requestBody as { transaction: Record<string, unknown> }
          ).transaction;
          expect(rest).toEqual(recordedRest);
        },
      },
    ],
    findCreatedTransaction: [
      {
        // Two rows on the day, neither carrying this write's import id.
        answers: [endpoint("list-for-readback")],
        run: (c) =>
          c.findCreatedTransaction(
            tx({ accountId: A.gone, date: "2026-10-05" }),
          ),
        check: (r) => expect(r).toBeNull(),
      },
    ],
    updateTransaction: [
      {
        answers: [endpoint("patch-transaction")],
        run: (c) =>
          c.updateTransaction("01a645e0-bf0c-4597-a2cc-3fd9568591ae", {
            memo: "fixture post patched",
            reconciled: true,
          }),
        check: (r, sent) => {
          expect(r).toBeUndefined();
          expect(sent[0]?.body).toEqual(
            endpoint("patch-transaction").requestBody,
          );
        },
      },
    ],
    deleteTransaction: [
      {
        answers: [endpoint("delete-transaction")],
        run: (c) => c.deleteTransaction("01a645e0-bf0c-4597-a2cc-3fd9568591ae"),
        check: (r, sent) => {
          expect(r).toBeUndefined();
          expect(sent.map((s) => s.method)).toEqual(["DELETE"]);
        },
      },
    ],
    getAccountTransactions: [
      {
        answers: [endpoint("transactions-default-until-today")],
        run: (c) => c.getAccountTransactions(A.chk, "2026-10-01"),
        check: (r) => {
          const list = r as Awaited<
            ReturnType<BudgetAPIClient["getAccountTransactions"]>
          >;
          expect(list.length).toBeGreaterThan(0);
          for (const t of list) {
            expect(t.accountId).toBe(A.chk);
            expect(t.date >= "2026-10-01").toBe(true);
          }
        },
      },
    ],
    getExcludedCategoryNames: [
      {
        answers: [],
        run: async (c) => c.getExcludedCategoryNames(),
        check: (r) => expect(r).toEqual(new Set()),
      },
    ],
  },
  defects: {
    months: {
      answers: [endpoint("months"), ...syncAll],
      run: (c) => c.getMonths("2026-11-01", "2026-11-01"),
      check: (r) => expect(r).toHaveLength(1),
    },
    patchDate: {
      answers: recording("patch-malformed-date-accepted"),
      run: (c) =>
        settle(
          c.updateTransaction("689d2414-39ad-4777-931c-e9aefd579787", {
            date: "06/10/2026",
          }),
        ),
      check: (r) => expect(r).toBeInstanceOf(BudgetApiError),
    },
    rejectedOnce: {
      // The note read reuses note-empty's answer; the PUT is the recording.
      answers: [
        { ...endpoint("note-empty"), path: `/notes/category/${C.car}` },
        ...recording("put-rejected-500-sent-six-times"),
      ],
      run: async (c) => {
        const write = await c.prepareGoalWrite(C.car, "monthly", 100);
        const applied = settle(write.apply());
        await vi.runAllTimersAsync();
        return applied;
      },
      check: (r, sent) => {
        expect(r).toBeInstanceOf(BudgetApiError);
        expect(sent.filter((s) => s.method === "PUT")).toHaveLength(1);
      },
    },
  },
};

// ── YNAB: built from the published spec ──

const YNAB_BUDGET = "budget-1";
const groceries = ynabCategory({
  id: "cat-groc",
  category_group_id: "g-exp",
  name: "Groceries",
  budgeted: 400_000,
  activity: -152_400,
  balance: 247_600,
  goal_type: "NEED",
  goal_target: 400_000,
  goal_cadence: 1,
  goal_cadence_frequency: 1,
});
const yearly = ynabCategory({
  id: "cat-ins",
  category_group_id: "g-exp",
  name: "Insurance",
  goal_type: "NEED",
  goal_target: 1_200_000,
  goal_cadence: 13,
  goal_cadence_frequency: 1,
});
const ynabTx = ynabTransaction({
  id: "tx-1",
  account_id: "acct-1",
  account_name: "Checking",
  date: "2026-10-15",
  amount: -29_350,
  category_id: "cat-groc",
  category_name: "Groceries",
  subtransactions: [],
});

const ynab: World = {
  config: { accessToken: "conformance-token", budgetId: YNAB_BUDGET },
  prefix: "https://api.ynab.com/v1",
  cases: {
    testConnection: [
      {
        answers: [
          ok("GET", `/budgets/${YNAB_BUDGET}/settings`, {
            data: { settings: {} },
          }),
        ],
        run: (c) => c.testConnection(),
        check: (r) => expect(r).toBeUndefined(),
      },
      {
        answers: [
          {
            ...ok("GET", `/budgets/${YNAB_BUDGET}/settings`, {
              error: {
                id: "401",
                name: "unauthorized",
                detail: "Unauthorized",
              },
            }),
            status: 401,
          },
        ],
        run: (c) => settle(c.testConnection()),
        check: (r) => expect(r).toMatchObject({ code: "auth" }),
      },
    ],
    getBudgetName: [
      {
        answers: [
          ok("GET", "/budgets?include_accounts=false", {
            data: { budgets: [{ id: YNAB_BUDGET, name: "Household" }] },
          }),
        ],
        run: (c) => c.getBudgetName(),
        check: (r) => expect(r).toBe("Household"),
      },
    ],
    getAccounts: [
      {
        answers: [
          ok("GET", `/budgets/${YNAB_BUDGET}/accounts`, {
            data: {
              accounts: [
                ynabAccount({
                  balance: 14_061_790,
                  cleared_balance: 14_000_000,
                }),
              ],
            },
          }),
        ],
        run: (c) => c.getAccounts(),
        check: (r) =>
          expect(r).toEqual([
            expect.objectContaining({
              id: "acct-1",
              type: "checking",
              onBudget: true,
              balance: 14061.79,
              clearedBalance: 14000,
            }),
          ]),
      },
      {
        answers: ynabFailure("rate-limited-every-try"),
        run: (c) => withRetries(c.getAccounts()),
        check: (r, sent) => {
          expect(r).toBeInstanceOf(BudgetApiError);
          expect(r).toMatchObject({ code: "rate-limit", status: 429 });
          expect(sent.map((s) => s.method)).toEqual(["GET", "GET", "GET"]);
        },
      },
    ],
    getAccountBalance: [
      {
        answers: [
          ok("GET", `/budgets/${YNAB_BUDGET}/accounts/acct-1`, {
            data: { account: ynabAccount({ balance: 14_061_790 }) },
          }),
        ],
        run: (c) => c.getAccountBalance("acct-1"),
        check: (r) => expect(r).toBe(14061.79),
      },
    ],
    getCategories: [
      {
        answers: [
          ok("GET", `/budgets/${YNAB_BUDGET}/categories`, {
            data: {
              category_groups: [
                {
                  id: "g-exp",
                  name: "Expenses",
                  hidden: false,
                  deleted: false,
                  categories: [groceries],
                },
              ],
            },
          }),
        ],
        run: (c) => c.getCategories(new Date()),
        check: (r) => {
          const groups = r as Awaited<
            ReturnType<BudgetAPIClient["getCategories"]>
          >;
          expect(groups).toHaveLength(1);
          expect(groups[0]?.categories[0]).toMatchObject({
            id: "cat-groc",
            groupId: "g-exp",
            budgeted: 400,
            activity: -152.4,
            goalTarget: 400,
          });
        },
      },
      {
        answers: ynabFailure("rate-limited-then-answered"),
        run: (c) => withRetries(c.getCategories(new Date())),
        check: (r, sent) => {
          const groups = r as Awaited<
            ReturnType<BudgetAPIClient["getCategories"]>
          >;
          expect(groups.flatMap((g) => g.categories.map((x) => x.id))).toEqual([
            "cat-groc",
          ]);
          expect(sent.map((s) => s.path)).toEqual([
            `/budgets/${YNAB_BUDGET}/categories`,
            `/budgets/${YNAB_BUDGET}/categories`,
          ]);
        },
      },
    ],
    getMonths: [
      {
        answers: [
          ok("GET", `/budgets/${YNAB_BUDGET}/months`, {
            data: {
              months: [
                ynabMonth({ month: "2026-10-01" }),
                ynabMonth({
                  month: "2026-11-01",
                  budgeted: 1_758_950,
                  to_be_budgeted: 10_679_490,
                }),
              ],
            },
          }),
        ],
        run: (c) => c.getMonths("2026-11-01", "2026-11-01"),
        check: (r) =>
          expect(r).toEqual([
            {
              month: "2026-11-01",
              income: 0,
              budgeted: 1758.95,
              activity: 0,
              toBeBudgeted: 10679.49,
            },
          ]),
      },
    ],
    getMonthDetail: [
      {
        answers: [
          ok("GET", `/budgets/${YNAB_BUDGET}/months/2026-11-01`, {
            data: {
              month: ynabMonth({
                month: "2026-11-01",
                categories: [{ ...groceries, category_group_name: "Expenses" }],
              }),
            },
          }),
        ],
        run: (c) => c.getMonthDetail("2026-11-01"),
        check: (r) => {
          const m = r as Awaited<ReturnType<BudgetAPIClient["getMonthDetail"]>>;
          expect(m.month).toBe("2026-11-01");
          expect(m.categories.map((x) => x.groupName)).toEqual(["Expenses"]);
        },
      },
    ],
    updateCategoryBudgeted: [
      {
        answers: [
          ok(
            "PATCH",
            `/budgets/${YNAB_BUDGET}/months/2026-12-01/categories/cat-groc`,
            { data: {} },
          ),
        ],
        run: (c) => c.updateCategoryBudgeted("2026-12-01", "cat-groc", 43.21),
        check: (_r, sent) =>
          expect(sent[0]?.body).toEqual({ category: { budgeted: 43_210 } }),
      },
      {
        answers: ynabFailure("deleted-category"),
        run: (c) =>
          withRetries(
            c.updateCategoryBudgeted("2026-12-01", "cat-gone", 43.21),
          ),
        check: (r, sent) => {
          expect(r).toMatchObject({ code: "client", status: 404 });
          expect(sent.map((s) => s.method)).toEqual(["PATCH"]);
        },
      },
    ],
    prepareGoalWrite: [
      {
        answers: [
          ok("GET", `/budgets/${YNAB_BUDGET}/categories/cat-groc`, {
            data: { category: groceries },
          }),
          ok("PATCH", `/budgets/${YNAB_BUDGET}/categories/cat-groc`, {
            data: {},
          }),
        ],
        run: async (c) => {
          const write = await c.prepareGoalWrite("cat-groc", "monthly", 75.25);
          await write.apply();
        },
        check: (_r, sent) =>
          expect(sent.filter((s) => s.method === "PATCH")).toEqual([
            {
              method: "PATCH",
              path: `/budgets/${YNAB_BUDGET}/categories/cat-groc`,
              body: {
                category: { goal_target: 75_250, goal_frequency: "monthly" },
              },
            },
          ]),
      },
      {
        answers: [
          ok("GET", `/budgets/${YNAB_BUDGET}/categories/cat-ins`, {
            data: { category: yearly },
          }),
        ],
        run: (c) => settle(c.prepareGoalWrite("cat-ins", "monthly", 100)),
        check: (r, sent) => {
          expect(r).toBeInstanceOf(BudgetApiError);
          expect((r as BudgetApiError).code).toBe("conflict");
          expect(sent.every((s) => s.method === "GET")).toBe(true);
        },
      },
      {
        answers: ynabFailure("deleted-category"),
        run: (c) => withRetries(c.prepareGoalWrite("cat-gone", "monthly", 75)),
        check: (r, sent) => {
          expect(r).toMatchObject({ code: "client", status: 404 });
          expect(sent.map((s) => s.method)).toEqual(["GET"]);
        },
      },
    ],
    getTransactions: [
      {
        answers: [
          ok(
            "GET",
            `/budgets/${YNAB_BUDGET}/transactions?since_date=2025-01-01`,
            {
              data: { transactions: [ynabTx] },
            },
          ),
        ],
        run: (c) => c.getTransactions("2025-01-01"),
        check: (r) =>
          expect(r).toEqual([
            expect.objectContaining({
              id: "tx-1",
              accountName: "Checking",
              amount: -29.35,
              categoryName: "Groceries",
              cleared: true,
            }),
          ]),
      },
      {
        // Ledgr reads whole lists, never a delta from last_knowledge_of_server,
        // so a reset can't leave it holding transactions YNAB no longer has.
        answers: ynabFailure("server-knowledge-reset"),
        run: async (c) => [
          await c.getTransactions("2026-10-01"),
          await c.getTransactions("2026-10-01"),
        ],
        check: (r, sent) => {
          const [before, after] = r as BudgetTransaction[][];
          expect(before?.map((t) => t.id)).toEqual(["tx-1", "tx-2"]);
          expect(after?.map((t) => t.id)).toEqual(["tx-1"]);
          expect(sent.map((s) => s.path)).toEqual([
            `/budgets/${YNAB_BUDGET}/transactions?since_date=2026-10-01`,
            `/budgets/${YNAB_BUDGET}/transactions?since_date=2026-10-01`,
          ]);
        },
      },
    ],
    createTransaction: [
      {
        answers: [
          ok("POST", `/budgets/${YNAB_BUDGET}/transactions`, {
            data: { transaction: { id: "tx-new" } },
          }),
        ],
        run: (c) => c.createTransaction(tx({})),
        check: (r, sent) => {
          expect(r).toBe("tx-new");
          expect(sent[0]?.body).toMatchObject({
            transaction: {
              account_id: "acct-1",
              amount: -19_990,
              cleared: "cleared",
            },
          });
        },
      },
      {
        // A 429 rejects the POST before it runs, so it is sent again, with
        // the same import_id.
        answers: ynabFailure("post-rate-limited-then-created"),
        run: (c) => withRetries(c.createTransaction(tx({}))),
        check: (r, sent) => {
          expect(r).toBe("tx-new");
          expect(sent.map((s) => s.method)).toEqual(["POST", "POST"]);
          expect(sent[1]?.body).toEqual(sent[0]?.body);
        },
      },
      {
        // A 503 may have run: the POST isn't sent twice.
        answers: ynabFailure("post-unavailable"),
        run: (c) => withRetries(c.createTransaction(tx({}))),
        check: (r, sent) => {
          expect(r).toMatchObject({ code: "server", status: 503 });
          expect(sent.map((s) => s.method)).toEqual(["POST"]);
        },
      },
    ],
    findCreatedTransaction: [
      {
        answers: [
          ok(
            "GET",
            `/budgets/${YNAB_BUDGET}/accounts/acct-1/transactions?since_date=2026-10-05`,
            {
              data: { transactions: [ynabTx] },
            },
          ),
        ],
        run: (c) => c.findCreatedTransaction(tx({ date: "2026-10-05" })),
        check: (r) => expect(r).toBeNull(),
      },
    ],
    updateTransaction: [
      {
        answers: [
          ok("PUT", `/budgets/${YNAB_BUDGET}/transactions/tx-1`, { data: {} }),
        ],
        run: (c) =>
          c.updateTransaction("tx-1", { memo: "patched", cleared: true }),
        check: (_r, sent) =>
          expect(sent[0]?.body).toEqual({
            transaction: { memo: "patched", cleared: "cleared" },
          }),
      },
    ],
    deleteTransaction: [
      {
        answers: [
          ok("DELETE", `/budgets/${YNAB_BUDGET}/transactions/tx-1`, {
            data: {},
          }),
        ],
        run: (c) => c.deleteTransaction("tx-1"),
        check: (_r, sent) =>
          expect(sent.map((s) => s.method)).toEqual(["DELETE"]),
      },
    ],
    getAccountTransactions: [
      {
        answers: [
          ok(
            "GET",
            `/budgets/${YNAB_BUDGET}/accounts/acct-1/transactions?since_date=2026-10-01`,
            {
              data: {
                transactions: [
                  ynabTx,
                  ynabTransaction({ id: "tx-gone", deleted: true }),
                ],
              },
            },
          ),
        ],
        run: (c) => c.getAccountTransactions("acct-1", "2026-10-01"),
        check: (r) =>
          expect((r as { id: string }[]).map((t) => t.id)).toEqual(["tx-1"]),
      },
    ],
    getExcludedCategoryNames: [
      {
        answers: [],
        run: async (c) => c.getExcludedCategoryNames(),
        check: (r) => expect((r as Set<string>).size).toBeGreaterThan(0),
      },
    ],
  },
  defects: {},
};

const WORLDS: Record<BudgetApiService, World> = { ynab, actual };

it("covers every registered provider", () => {
  expect(Object.keys(WORLDS).sort()).toEqual(
    Object.keys(BUDGET_PROVIDERS).sort(),
  );
  expect([...BUDGET_API_SERVICE_VALUES].sort()).toEqual(
    Object.keys(BUDGET_PROVIDERS).sort(),
  );
});

describe.each(BUDGET_API_SERVICE_VALUES)("%s", (service) => {
  const world = WORLDS[service];
  let unanswered: string[] = [];

  beforeEach(() => {
    resetActualWrapperGates();
    // The current month is the recording's (getCategories reads "today").
    vi.useFakeTimers({ now: new Date("2026-11-02T12:00:00") });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    expect(unanswered).toEqual([]);
  });

  /** A client from the registry, talking to a fake service. */
  function connect(answers: Pair[], echo?: string) {
    const service_ = fakeService(world.prefix, answers, echo);
    unanswered = service_.unanswered;
    vi.stubGlobal("fetch", vi.fn(service_.fetchFn));
    const client = BUDGET_PROVIDERS[service].createClient(
      encryptJson(world.config),
    );
    if (!client) throw new Error(`${service}: no client from its config`);
    return { client, sent: service_.sent };
  }

  for (const [member, cases] of Object.entries(world.cases)) {
    cases.forEach((c, i) => {
      it(`${member}${cases.length > 1 ? ` (${i + 1})` : ""}`, async () => {
        const { client, sent } = connect(c.answers, c.echo);
        const result = await c.run(client);
        c.check(result, sent);
      });
    });
  }

  /** A recorded defect, run as a case: each fails today. */
  const defect = (key: keyof World["defects"]) => async () => {
    const d = world.defects[key];
    if (!d) throw new Error(`${service} records no ${key} defect`);
    const { client, sent } = connect(d.answers);
    d.check(await d.run(client), sent);
  };
  if (service === "actual") {
    it.fails(
      "getMonths takes the YYYY-MM-01 bounds every other member takes (v0.11 getMonths month format, todo/v0.11.x.md dead write paths)",
      defect("months"),
    );
    it.fails(
      "a PATCH date Actual ignores isn't reported as done (v0.11 Actual answers 200 for writes it didn't apply)",
      defect("patchDate"),
    );
    it.fails(
      "a write the wrapper rejects is sent once (v0.11 the wrapper's 500 covers genuine rejections)",
      defect("rejectedOnce"),
    );
  }
});
