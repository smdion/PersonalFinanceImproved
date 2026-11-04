/**
 * Behavior baseline, part d (v0.10.0; DECISIONS.md "Sync-write pins"): the
 * rows a sync writes. Recorded YNAB and Actual Budget responses
 * (`sync/ynab.json`, `sync/actual.json`: one invented budget, shaped as
 * each API answers) are replayed through the real clients and
 * `sync.syncAll`, and every row the sync adds or changes must equal
 * `__sync__/<service>.json`.
 *
 * The household is the baseline's screens-e2e B (households.ts) with a car
 * loan, every kind of mapping (cash, credit card, mortgage balance and
 * home value, a debt, an asset created from a tracking account, a
 * portfolio account pushed to), and both savings goals linked to budget
 * categories. It syncs on 2026-02-15 and again on 2026-03-07, so the
 * second sync also harvests February's cached month into savings history.
 *
 * What's pinned, per table: the rows the two syncs wrote (new or changed,
 * every column but timestamps and the encrypted connection config), and
 * how many rows they removed. These pin today's behavior, bugs included.
 * The baseline rule in router-baseline.test.ts governs these files too;
 * `LEDGR_BASELINE_WRITE=1` rewrites them for the deletion case only.
 */
import "../routers/setup-mocks";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { is } from "drizzle-orm";
import { SQLiteTable, getTableConfig } from "drizzle-orm/sqlite-core";
import * as sqliteSchema from "@/lib/db/schema-sqlite";
import { resetActualWrapperGates } from "@/lib/budget-api/actual-client";
import { createTestCaller } from "../routers/setup";
import { seedHousehold } from "./seed";
import { HOUSEHOLDS } from "./households";
import { REGENERATE } from "./router-suite";

type Service = "ynab" | "actual";

interface Recording {
  responses: Record<string, unknown>;
}

const SYNC_DIR = path.join(__dirname, "__sync__");
const SYNC_DATES = ["2026-02-15T18:00:00.000Z", "2026-03-07T18:00:00.000Z"];
const ACTUAL_SERVER = "https://actual.baseline.example";
/** Not written: timestamps, and the connection config (encrypted with a
 *  fresh random IV every save). */
const NOT_PINNED = /At$|^config$/;

function recording(service: Service): Recording {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, "sync", `${service}.json`), "utf8"),
  ) as Recording;
}

/** Replays a recording: the request's path after the budget's base URL
 *  (Actual's transaction lists without their query string). A request the
 *  recording doesn't hold fails the sync, naming it. */
function replay(service: Service) {
  const { responses } = recording(service);
  const base =
    service === "ynab"
      ? "https://api.ynab.com/v1/budgets/budget-baseline"
      : `${ACTUAL_SERVER}/v1/budgets/sync-baseline`;
  return vi.fn(async (url: string | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    let rest = String(url).replace(base, "");
    if (service === "actual" && /\/transactions\?/.test(rest))
      rest = rest.replace(/\?.*$/, "");
    const body = responses[`${method} ${rest}`];
    if (body === undefined)
      throw new Error(`no recorded response for ${method} ${rest}`);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}

type Db = Awaited<ReturnType<typeof createTestCaller>>["db"];

/** Every table's rows, as JSON strings, without the unpinned columns. */
function tableRows(db: Db): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const table of Object.values(sqliteSchema)) {
    if (!is(table, SQLiteTable)) continue;
    const rows = db.select().from(table).all() as Record<string, unknown>[];
    out.set(
      getTableConfig(table).name,
      rows
        .map((row) =>
          JSON.stringify(
            Object.fromEntries(
              Object.entries(row).filter(([k]) => !NOT_PINNED.test(k)),
            ),
          ),
        )
        .sort(),
    );
  }
  return out;
}

/** Per table: the rows `after` has that `before` didn't (written or
 *  changed), and how many of `before`'s rows are gone or changed. */
function writtenRows(
  before: Map<string, string[]>,
  after: Map<string, string[]>,
) {
  const out: Record<string, { written: unknown[]; replacedOrRemoved: number }> =
    {};
  for (const [table, rows] of after) {
    const old = new Set(before.get(table) ?? []);
    const now = new Set(rows);
    const written = rows.filter((r) => !old.has(r));
    const gone = [...old].filter((r) => !now.has(r)).length;
    if (written.length || gone)
      out[table] = {
        written: written.map((r): unknown => JSON.parse(r)),
        replacedOrRemoved: gone,
      };
  }
  return out;
}

const household = HOUSEHOLDS.find((h) => h.key === "e2e-b")!;

describe.each<Service>(["ynab", "actual"])("sync writes: %s", (service) => {
  let ctx: Awaited<ReturnType<typeof createTestCaller>>;
  let written: ReturnType<typeof writtenRows>;

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(SYNC_DATES[0]!) });
    vi.stubGlobal("fetch", replay(service));
    resetActualWrapperGates();
    ctx = await createTestCaller();
    const { caller } = ctx;
    const ids = await seedHousehold(caller, household);
    const debt = await caller.debts.create({
      name: "Car loan",
      kind: "auto_loan",
      ownerPersonId: null,
      balance: "14000",
      balanceAsOf: "2026-01-31",
      interestRate: "0.069",
      monthlyPayment: "435",
    });
    const goals = await caller.savings.savingsGoals.list();
    const goal = (name: string) => goals.find((g) => g.name === name)!.id;

    await caller.sync.saveConnection(
      service === "ynab"
        ? {
            service,
            accessToken: "token-baseline",
            budgetId: "budget-baseline",
          }
        : {
            service,
            serverUrl: ACTUAL_SERVER,
            apiKey: "key-baseline",
            budgetSyncId: "sync-baseline",
          },
    );
    await caller.sync.setActiveBudgetApi({ value: service });
    await caller.savings.linkGoalToApi({
      goalId: goal("Emergency fund"),
      service,
      apiCategoryId: "cat-efund",
      apiCategoryName: "Emergency fund",
    });
    await caller.savings.linkGoalToApi({
      goalId: goal("New roof"),
      service,
      apiCategoryId: "cat-roof",
      apiCategoryName: "New roof",
    });
    const loanId = ids.mortgage!;
    await caller.sync.updateAccountMappings({
      service,
      mappings: [
        {
          localId: "cash",
          localName: "Cash",
          remoteAccountId: "acct-checking",
          syncDirection: "pull",
        },
        {
          localId: "cash",
          localName: "Cash",
          remoteAccountId: "acct-savings",
          syncDirection: "pull",
        },
        {
          localId: "creditCard",
          localName: "Credit cards",
          remoteAccountId: "acct-visa",
          syncDirection: "pull",
        },
        {
          localId: `mortgage:${loanId}:loanBalance`,
          localName: "Home loan",
          remoteAccountId: "acct-mortgage",
          syncDirection: "pull",
          loanId,
          loanMapType: "loanBalance",
        },
        {
          localId: `mortgage:${loanId}:propertyValue`,
          localName: "Home value",
          remoteAccountId: "acct-home",
          syncDirection: "pull",
          loanId,
          loanMapType: "propertyValue",
        },
        {
          localId: `debt:${debt!.id}`,
          localName: "Car loan",
          remoteAccountId: "acct-carloan",
          syncDirection: "pull",
          debtId: debt!.id,
        },
        {
          localId: `performance:${ids.perf.JBRK}`,
          localName: "Joint brokerage",
          remoteAccountId: "acct-brokerage",
          syncDirection: "push",
          performanceAccountId: ids.perf.JBRK,
        },
      ],
    });
    await caller.sync.createAssetAndMap({
      service,
      assetName: "Family Car",
      balance: 21000,
      remoteAccountId: "acct-car",
      syncDirection: "pull",
    });

    const before = tableRows(ctx.db);
    for (const date of SYNC_DATES) {
      vi.setSystemTime(new Date(date));
      await caller.sync.syncAll({ service });
    }
    written = writtenRows(before, tableRows(ctx.db));
  }, 60_000);

  afterAll(() => {
    ctx?.cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("writes the pinned rows", () => {
    const file = path.join(SYNC_DIR, `${service}.json`);
    if (REGENERATE) {
      fs.mkdirSync(SYNC_DIR, { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify(written, null, 1)}\n`);
      return;
    }
    expect(written).toEqual(JSON.parse(fs.readFileSync(file, "utf8")));
  });
});
