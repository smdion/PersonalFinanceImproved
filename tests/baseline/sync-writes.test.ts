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
 * how many rows they removed; then `sync.getPreview` after them (v0.10.3
 * plan commit 3, owner Q4: an added pin), which reads the feed the syncs
 * cached, in `__sync__/<service>.preview.json` without its timestamps.
 * These pin today's behavior, bugs included.
 * The baseline rule in router-baseline.test.ts governs these files too;
 * `LEDGR_BASELINE_WRITE=1` rewrites them for the deletion case only.
 */
import "../routers/setup-mocks";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { resetActualWrapperGates } from "@/lib/budget-api/actual-client";
import { createTestCaller } from "../routers/setup";
import { seedHousehold } from "./seed";
import { HOUSEHOLDS } from "./households";
import { REGENERATE } from "./router-suite";
import { NOT_PINNED, tableRows, writtenRows } from "./table-rows";

type Service = "ynab" | "actual";

interface Recording {
  responses: Record<string, unknown>;
}

const SYNC_DIR = path.join(__dirname, "__sync__");
const SYNC_DATES = ["2026-02-15T18:00:00.000Z", "2026-03-07T18:00:00.000Z"];
const ACTUAL_SERVER = "https://actual.baseline.example";

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

/** A value without its timestamps (the columns tableRows leaves out). */
function withoutTimestamps(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutTimestamps);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([k]) => !NOT_PINNED.test(k))
      .map(([k, v]) => [k, withoutTimestamps(v)]),
  );
}

const household = HOUSEHOLDS.find((h) => h.key === "e2e-b")!;

describe.each<Service>(["ynab", "actual"])("sync writes: %s", (service) => {
  let ctx: Awaited<ReturnType<typeof createTestCaller>>;
  let written: ReturnType<typeof writtenRows>;
  let preview: unknown;

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
    preview = withoutTimestamps(await caller.sync.getPreview({ service }));
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

  it("previews the pinned figures from the cached feed", () => {
    const file = path.join(SYNC_DIR, `${service}.preview.json`);
    if (REGENERATE) {
      fs.writeFileSync(file, `${JSON.stringify(preview, null, 1)}\n`);
      return;
    }
    expect(preview).toEqual(JSON.parse(fs.readFileSync(file, "utf8")));
  });
});
