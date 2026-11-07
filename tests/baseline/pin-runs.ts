/**
 * What the added baseline pins run (v0.10.3 plan commit 3), shared by
 * their SQLite files (sync-writes, finalize-writes, projection-text) and
 * pins-postgres.test.ts, which runs them on PostgreSQL against the same
 * files. Imports no app module at load (setup-postgres.ts needs that).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { vi } from "vitest";
import type { Db } from "@/lib/db";
import type { Caller, Household, SeededIds } from "./seed";
import { PROCEDURES, callProcedure } from "./procedures";
import { NOT_PINNED, writtenRows, type Rows } from "./table-rows";

export type Service = "ynab" | "actual";

interface Recording {
  responses: Record<string, unknown>;
}

export const SYNC_DATES = [
  "2026-02-15T18:00:00.000Z",
  "2026-03-07T18:00:00.000Z",
];
const ACTUAL_SERVER = "https://actual.baseline.example";

function recording(service: Service): Recording {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, "sync", `${service}.json`), "utf8"),
  ) as Recording;
}

/** Replays a recording: the request's path after the budget's base URL
 *  (Actual's transaction lists without their query string). A request the
 *  recording doesn't hold fails the sync, naming it. */
export function replay(service: Service) {
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
export function withoutTimestamps(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutTimestamps);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([k]) => !NOT_PINNED.test(k))
      .map(([k, v]) => [k, withoutTimestamps(v)]),
  );
}

/**
 * Part d's sync household (e2e-b, seeded) made ready for `service`: a car
 * loan, the connection, both savings goals linked, every kind of mapping
 * and an asset created from a tracking account.
 */
export async function prepareSync(
  caller: Caller,
  service: Service,
  ids: SeededIds,
): Promise<void> {
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
}

/** The two syncs, each on its own date. */
export async function runSyncs(caller: Caller, service: Service) {
  for (const date of SYNC_DATES) {
    vi.setSystemTime(new Date(date));
    await caller.sync.syncAll({ service });
  }
}

/** An invented 2025 for an account worth `total` today. */
function flows(total: number) {
  const ending = Math.round(total * 0.9);
  const beginning = Math.round(total * 0.8);
  const contributions = Math.round(total * 0.06);
  const employer = Math.round(total * 0.01);
  return {
    beginningBalance: String(beginning),
    totalContributions: String(contributions),
    employerContributions: String(employer),
    yearlyGainLoss: String(ending - beginning - contributions - employer),
    endingBalance: String(ending),
  };
}

export const FINALIZE_YEARS = [2025, 2026];

/**
 * A finalize run's first year: an account row for each of `household`'s
 * accounts (invented from its snapshot total) and each person's salary.
 * A refused account row is kept in `written` as `{ $threw }`.
 */
async function seedFirstYear(
  caller: Caller,
  household: Household,
  ids: SeededIds,
  written: Record<string, unknown>,
): Promise<void> {
  const YEARS = FINALIZE_YEARS;
  for (const account of household.accounts) {
    const total = account.snapshot.reduce(
      (sum, row) => sum + Number(row.amount),
      0,
    );
    try {
      await caller.performance.createAccount({
        year: YEARS[0]!,
        performanceAccountId: ids.perf[account.key]!,
        ...flows(total),
      });
    } catch (error) {
      // el-h5's two accounts of one name, institution and owner share
      // a year row's unique key, so the second is refused (a v0.11 bug,
      // account-part-uniqueness.test.ts); that is pinned too.
      written[`createAccount ${account.key}`] = {
        $threw: (error as Error).message,
      };
    }
  }
  // 2025's salary, recorded as the Historical page does (the year is
  // past, so no Salary Profile stands in): each person's job salary, or
  // 0 for a person with none.
  for (const person of household.people) {
    const salary = household.jobs
      .filter((j) => j.person === person.key)
      .reduce((sum, j) => sum + Number(j.entry.salary ?? 0), 0);
    await caller.historical.upsertSalary({
      personId: ids.people[person.key]!,
      year: YEARS[0]!,
      salary,
    });
  }
}

/** One finalize: the rows it wrote, or `{ $threw }` when it threw. */
async function finalizeOnce(
  caller: Caller,
  year: number,
  read: () => Promise<Rows>,
): Promise<unknown> {
  const before = await read();
  try {
    await caller.performance.finalizeYear({ year });
    return writtenRows(before, await read());
  } catch (error) {
    return { $threw: (error as Error).message };
  }
}

/**
 * The finalize pin's run on a seeded household: 2025 account rows and
 * salaries, then 2025 and 2026 finalized, each finalize's written rows
 * read through `read`. A call that threw is kept as `{ $threw }`.
 */
export async function finalizeWrites(
  caller: Caller,
  household: Household,
  ids: SeededIds,
  read: () => Promise<Rows>,
): Promise<Record<string, unknown>> {
  const written: Record<string, unknown> = {};
  await seedFirstYear(caller, household, ids, written);
  for (const year of FINALIZE_YEARS)
    written[year] = await finalizeOnce(caller, year, read);
  return written;
}

/**
 * v0.10.4 plan commit 27a (owner Q2: added as pins): the paths the run
 * above never takes. The base household seeded without a snapshot, so
 * the year-end tax-location breakdown has none to read.
 */
export const FINALIZE_VARIANT = { key: "ws-h3f", base: "ws-h3" };

export function finalizeVariantHousehold(base: Household): Household {
  return {
    ...base,
    key: FINALIZE_VARIANT.key,
    source: `${base.key} without a snapshot (finalize variant, plan 27a)`,
    accounts: base.accounts.map((a) => ({ ...a, snapshot: [] })),
  };
}

/** The year-end row an earlier version or an import left for 2025
 *  (no procedure writes one); finalize updates it in place, keeping its
 *  hand-entered AGI and taxes. Its breakdown isn't empty, so the empty
 *  one finalize reads with no snapshot shows. */
const STORED_YEAR_END = {
  yearEndDate: "2025-12-31",
  grossIncome: "1",
  combinedAgi: "98765",
  taxesPaid: "12345",
  cash: "1",
  portfolioTotal: "1",
  portfolioByTaxLocation: {
    retirement: { preTax: 1 },
    portfolio: { afterTax: 1 },
  },
};

/**
 * The variant's run, on `variant` (finalizeVariantHousehold) seeded as
 * `ids`, its 2025 rows invented from `base`'s snapshot. Before 2025 is
 * finalized: 2026 already holds the first account's row (edited once, so
 * its category and Portfolio have 2026 annual rows) and 2025 a stored
 * year-end row, written through `db`. Then 2025 is finalized twice; the
 * second is refused (CONFLICT) and writes nothing.
 */
export async function finalizeVariantWrites(
  caller: Caller,
  base: Household,
  ids: SeededIds,
  read: () => Promise<Rows>,
  db: Db,
): Promise<Record<string, unknown>> {
  const [first, second] = FINALIZE_YEARS as [number, number];
  const written: Record<string, unknown> = {};
  await seedFirstYear(caller, base, ids, written);

  const account = base.accounts[0]!;
  const row = await caller.performance.createAccount({
    year: second,
    performanceAccountId: ids.perf[account.key]!,
    ...flows(1000),
  });
  await caller.performance.batchUpdateAccounts({
    accounts: [
      {
        id: row!.id,
        ...flows(1000),
        distributions: "0",
        rollovers: "0",
        fees: "0",
      },
    ],
  });
  const schema = await import("@/lib/db/schema");
  await db.insert(schema.netWorthAnnual).values(STORED_YEAR_END);

  written[first] = await finalizeOnce(caller, first, read);
  const before = await read();
  const again = (await finalizeOnce(caller, first, read)) as object;
  written[`${first} again`] = {
    ...again,
    wrote: writtenRows(before, await read()),
  };
  return written;
}

/** Part c's: ids, timestamps and timings (numbers.ts). */
const NOT_TEXT = /^id$|Id$|Ids$|At$|Ms$/;
const NUMBER_TEXT = /^-?\d+(\.\d+)?$/;

export type TextTree =
  string | boolean | null | TextTree[] | { [key: string]: TextTree };

/** The value's text and flags in its own shape; `undefined` when it has
 *  none. An array item with none is kept as null, so indexes stay put. */
export function textTree(value: unknown): TextTree | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string")
    return NUMBER_TEXT.test(value) ? undefined : value;
  if (Array.isArray(value)) {
    const items = value.map((item) => textTree(item) ?? null);
    return items.some((item) => item !== null) ? items : undefined;
  }
  if (value === null || typeof value !== "object" || value instanceof Date)
    return undefined;
  const entries =
    value instanceof Map
      ? [...value.entries()].map(([k, v]) => [String(k), v] as const)
      : Object.entries(value);
  const out: Record<string, TextTree> = {};
  for (const [k, v] of entries.sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (NOT_TEXT.test(k)) continue;
    const t = textTree(v);
    if (t !== undefined) out[k] = t;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

const projection = PROCEDURES.find(
  (p) => p.path === "projection.computeProjection",
)!;

/** The text pin of a seeded household: computeProjection's result, its
 *  text and flags. */
export async function projectionText(
  caller: Caller,
  household: Household,
  ids: SeededIds,
): Promise<TextTree> {
  const response = (await callProcedure(
    caller,
    projection,
    projection.input?.({ household, ids }),
  )) as { result?: unknown };
  return textTree(response.result) ?? null;
}

/** The Simulation and Coast FIRE procedures whose text the second text
 *  pin keeps (v0.10.4 plan commit 27c). */
const SIMULATIONS = [
  "projection.computeCoastFire",
  "projection.computeCoastFireMC",
  "projection.computeCoastFireProbe",
  "projection.computeMonteCarloProjection",
].map((p) => PROCEDURES.find((procedure) => procedure.path === p)!);

/** The second text pin of a seeded household: each Simulation and Coast
 *  FIRE response's text and flags, by procedure, called in the router
 *  baseline's order with its input (one it can't be called with is left
 *  out). A call
 *  that threw is kept as `{ $threw }`. */
export async function simulationText(
  caller: Caller,
  household: Household,
  ids: SeededIds,
): Promise<TextTree> {
  const out: Record<string, TextTree> = {};
  for (const procedure of SIMULATIONS) {
    const input = procedure.input?.({ household, ids });
    if (input === null) continue;
    try {
      out[procedure.path] =
        textTree(await callProcedure(caller, procedure, input)) ?? null;
    } catch (error) {
      out[procedure.path] = { $threw: (error as Error).message };
    }
  }
  return out;
}

/** A pin file's JSON, or null when there is none. */
export function readPin(file: string): unknown {
  if (!fs.existsSync(file)) return null;
  const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  return value;
}

export const PIN_DIRS = {
  sync: path.join(__dirname, "__sync__"),
  finalize: path.join(__dirname, "__sync__", "finalize"),
  text: path.join(__dirname, "__text__"),
};
