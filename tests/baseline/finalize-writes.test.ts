/**
 * Behavior baseline, part d: the rows `performance.finalizeYear` writes
 * (v0.10.3 plan commit 3; owner Q4: added as pins). The router baseline
 * pins queries only, and this mutation is the one the plan stages.
 *
 * Each household (households.ts) is seeded as the router baseline seeds
 * it, on its clock (BASELINE_NOW) with no network. Each of its performance
 * accounts gets a 2025 account_performance row, invented from its snapshot
 * total, and each person a 2025 salary (their job's, or 0); 2025 is
 * finalized, then 2026 from the rows that finalize made (its salary from
 * the active Salary Profile), so the second finalize reads the first
 * one's lifetime figures. Every row
 * each finalize adds or changes (account_performance and next year's rows,
 * annual_performance, net_worth_annual, the stored settings, anything
 * else; every column but timestamps), and how many rows it replaced or
 * removed, must equal `__sync__/finalize/<household>.json`. A call that
 * threw is recorded as `{ "$threw": <message> }`. These pin today's
 * behavior, bugs included. The baseline rule in router-baseline.test.ts
 * governs these files too; `LEDGR_BASELINE_WRITE=1` writes them.
 */
// First: the SQLite harness's mocks, then the baseline's.
import "../routers/setup-mocks";
import "./mocks";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { createTestCaller } from "../routers/setup";
import { seedHousehold } from "./seed";
import { HOUSEHOLDS } from "./households";
import { BASELINE_NOW, REGENERATE } from "./router-suite";
import { tableRows, writtenRows } from "./table-rows";

const DIR = path.join(__dirname, "__sync__", "finalize");
const YEARS = [2025, 2026];

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

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: BASELINE_NOW });
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("network disabled in baseline"))),
  );
});
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe.each(HOUSEHOLDS.map((h) => [h.key, h] as const))(
  "finalize writes: %s",
  (key, household) => {
    let ctx: Awaited<ReturnType<typeof createTestCaller>>;
    const written: Record<string, unknown> = {};

    beforeAll(async () => {
      ctx = await createTestCaller();
      const { caller } = ctx;
      const ids = await seedHousehold(caller, household);
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
      for (const year of YEARS) {
        const before = tableRows(ctx.db);
        try {
          await caller.performance.finalizeYear({ year });
          written[year] = writtenRows(before, tableRows(ctx.db));
        } catch (error) {
          written[year] = { $threw: (error as Error).message };
        }
      }
    }, 120_000);

    afterAll(() => ctx?.cleanup());

    it("writes the pinned rows", () => {
      const file = path.join(DIR, `${key}.json`);
      if (REGENERATE) {
        fs.mkdirSync(DIR, { recursive: true });
        fs.writeFileSync(file, `${JSON.stringify(written, null, 1)}\n`);
        return;
      }
      expect(
        fs.existsSync(file),
        `no baseline file ${path.relative(process.cwd(), file)}`,
      ).toBe(true);
      expect(written).toEqual(JSON.parse(fs.readFileSync(file, "utf8")));
    });
  },
);
