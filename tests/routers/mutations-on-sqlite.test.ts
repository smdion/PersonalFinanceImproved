/**
 * Every mutation on the app router is called by a test that runs it on a
 * real database (SQLite here; CI's PostgreSQL job runs the same router
 * files on PostgreSQL). A write path no household uses broke unseen before:
 * `performance.finalizeYear` failed on SQLite for 209 days.
 *
 * "Called" is read from the source of the real-database test folders
 * (`caller.<path>(`, whitespace ignored), not from the component tests,
 * which mock tRPC. A mutation added without a test fails here; one listed
 * in NOT_YET_CALLED that a test now calls fails too, so the list only
 * shrinks.
 */
import "./setup-mocks";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

/** Folders whose tests run procedures on a real database. */
const REAL_DB_DIRS = [
  "routers",
  "baseline",
  "server",
  "integration",
  "db",
  "demo",
];

/** Mutations no real-database test calls yet, each with its reason. */
const NOT_YET_CALLED: Record<string, string> = {
  "demo.deactivateDemo":
    "demo sessions exist only on PostgreSQL; no PostgreSQL test calls it yet",
  "paycheck.earnings.update": "no test yet (found by TS3)",
  "settings.taxDataSync.checkNow": "no test yet (found by TS3)",
  "savings.extraPaycheckRouting.saveGrowth": "no test yet (found by TS3)",
  "savings.extraPaycheckRouting.setEnabled": "no test yet (found by TS3)",
  "savings.extraPaycheckRouting.saveOverride": "no test yet (found by TS3)",
  "retirement.projectionOverrides.clear": "no test yet (found by TS3)",
  "performance.updateCostBasis": "no test yet (found by TS3)",
  "investments.deleteHoldingPeriod": "no test yet (found by TS3)",
};

function* sources(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* sources(full);
    else if (/\.tsx?$/.test(e.name)) yield full;
  }
}

function realDbTestText(): string {
  const tests = path.resolve(__dirname, "..");
  return REAL_DB_DIRS.flatMap((d) => [...sources(path.join(tests, d))])
    .filter((f) => f !== __filename)
    .map((f) => fs.readFileSync(f, "utf8").replace(/\s+/g, ""))
    .join("\n");
}

async function mutationPaths(): Promise<string[]> {
  const { appRouter } = await import("@/server/routers");
  const procedures: Record<string, unknown> = appRouter._def.procedures;
  return Object.entries(procedures)
    .filter(
      ([, p]) => (p as { _def: { type: string } })._def.type === "mutation",
    )
    .map(([p]) => p)
    .sort();
}

describe("every mutation runs on a real database", () => {
  it("each is called by a real-database test, or listed as not yet", async () => {
    const text = realDbTestText();
    const called = (p: string) => text.includes(`.${p}(`);
    const paths = await mutationPaths();
    expect(paths.length).toBeGreaterThan(100);
    expect(
      paths.filter((p) => !called(p) && !(p in NOT_YET_CALLED)),
      "a mutation no real-database test calls: add a router test that runs it",
    ).toEqual([]);
    expect(
      Object.keys(NOT_YET_CALLED).filter((p) => called(p)),
      "now called by a test: remove it from NOT_YET_CALLED",
    ).toEqual([]);
    expect(
      Object.keys(NOT_YET_CALLED).filter((p) => !paths.includes(p)),
      "no longer a mutation: remove it from NOT_YET_CALLED",
    ).toEqual([]);
  }, 60_000);
});
