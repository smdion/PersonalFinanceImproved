/**
 * The router baseline, shared by the SQLite and PostgreSQL files: seed each
 * household into a database migrated from empty, call every query in
 * PROCEDURES, and compare its numbers with
 * `__baseline__/<household>/<procedure>.json`. See router-baseline.test.ts
 * for the rule that governs those files.
 *
 * Imports no app module at load (the PostgreSQL harness must point the db
 * module at its database first).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Caller, Household, SeededIds } from "./seed";
import { seedHousehold } from "./seed";
import { HOUSEHOLDS } from "./households";
import {
  PROCEDURES,
  SKIPPED,
  DELETED_IN_V0100,
  callProcedure,
  procedureName,
} from "./procedures";
import { flatten, numberTree, type NumberTree } from "./numbers";

const BASELINE_DIR = path.join(__dirname, "__baseline__");

/** The clock every run reads: Saturday 2026-03-07, noon in Chicago. */
export const BASELINE_NOW = new Date("2026-03-07T18:00:00.000Z");

/** Set to rewrite the files from this run (SQLite only). See the header of
 *  router-baseline.test.ts for the one case that allows it. */
export const REGENERATE = process.env.LEDGR_BASELINE_WRITE === "1";

/** A thrown procedure is recorded as this, so it stays thrown. */
const THREW: NumberTree = { $threw: 1 };

/** A procedure that returned no numbers at all. */
const EMPTY: NumberTree = {};

function fileFor(household: string, procedure: string): string {
  return path.join(BASELINE_DIR, household, `${procedure}.json`);
}

function readNumbers(file: string): NumberTree | null {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as NumberTree;
}

/** One line of compact JSON: the files are compared, not read, and a
 *  projection's year-by-year accounts run to thousands of numbers. */
function writeNumbers(file: string, numbers: NumberTree): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(numbers)}\n`);
}

/** Every query procedure on the app router, by dotted path. */
async function routerQueries(): Promise<string[]> {
  const { appRouter } = await import("@/server/routers");
  const procedures: Record<string, unknown> = appRouter._def.procedures;
  return Object.entries(procedures)
    .filter(([, p]) => isQuery(p))
    .map(([name]) => name)
    .sort();
}

function isQuery(procedure: unknown): boolean {
  if (procedure == null || !("_def" in Object(procedure))) return false;
  const def: unknown = (procedure as { _def: unknown })._def;
  return (def as { type?: unknown }).type === "query";
}

export interface RouterBaselineOptions {
  dialect: "sqlite" | "postgres";
  /** The households this file runs (SQLite splits them over two files so
   *  they run in parallel). */
  households: Household[];
  /** Run the checks over the whole baseline (every query covered, one
   *  folder per household): once per dialect. */
  wholeBaselineChecks: boolean;
  /** A database migrated from empty and an admin caller on it. */
  open: () => Promise<{ caller: Caller; close: () => Promise<void> | void }>;
  /** Paths whose numbers this dialect is known to get differently, by
   *  `<household>/<procedure>`, or the household "*" for every household
   *  ("*" for the whole result; "unordered" when only the order of rows
   *  differs: every array is compared as a set, all numbers still
   *  checked): each one is a v0.11 bug. */
  knownGaps?: Record<string, string[]>;
  timeout?: number;
}

export function defineRouterBaseline(opts: RouterBaselineOptions): void {
  const write = REGENERATE && opts.dialect === "sqlite";
  const timeout = opts.timeout ?? 60_000;

  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: BASELINE_NOW });
    // Nothing leaves the test: a procedure that would call an outside
    // service gets a network error, the same on every run.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network disabled in baseline"))),
    );
  });
  afterAll(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  if (opts.wholeBaselineChecks) defineWholeBaselineChecks(write);

  describe.each(opts.households.map((h) => [h.key, h] as const))(
    "%s",
    (key, household) => {
      let caller: Caller;
      let ids: SeededIds;
      let close: () => Promise<void> | void = () => {};
      const seen = new Set<string>();

      beforeAll(async () => {
        const opened = await opts.open();
        caller = opened.caller;
        close = opened.close;
        ids = await seedHousehold(caller, household);
      }, timeout);

      afterAll(async () => {
        await close();
        if (write) return;
        // A file with no procedure behind it: the procedure stopped
        // applying to this household, or was renamed.
        const dir = path.join(BASELINE_DIR, key);
        const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
        const stale = files.filter((f) => !seen.has(f.replace(/\.json$/, "")));
        expect(stale, `${key}: files with no procedure`).toEqual([]);
      });

      it.each(PROCEDURES.map((p) => [procedureName(p), p] as const))(
        "%s",
        async (name, procedure) => {
          const input = procedure.input?.({ household, ids });
          if (input === null) return; // nothing to call it with here
          seen.add(name);
          let numbers: NumberTree;
          try {
            numbers =
              numberTree(await callProcedure(caller, procedure, input)) ??
              EMPTY;
          } catch (error) {
            if (write) console.warn(`${key} ${name} threw:`, error);
            numbers = THREW;
          }
          const file = fileFor(key, name);
          if (write) {
            writeNumbers(file, numbers);
            return;
          }
          const expected = readNumbers(file);
          expect(
            expected,
            `no baseline file ${path.relative(process.cwd(), file)}`,
          ).not.toBeNull();
          const gaps = [
            ...(opts.knownGaps?.[`${key}/${name}`] ?? []),
            ...(opts.knownGaps?.[`*/${name}`] ?? []),
          ];
          if (gaps.includes("*")) return; // the whole result differs
          const order = gaps.includes("unordered")
            ? sortArrays
            : (t: NumberTree) => t;
          const figures = (tree: NumberTree) =>
            Object.fromEntries(
              Object.entries(flatten(order(tree))).filter(
                ([p]) => !gaps.includes(p),
              ),
            );
          expect(figures(numbers)).toEqual(figures(expected!));
        },
        timeout,
      );
    },
  );
}

/** Every array's items in one fixed order (by their content), innermost
 *  first: two results that differ only in row order become equal. */
function sortArrays(tree: NumberTree): NumberTree {
  if (Array.isArray(tree)) {
    return tree
      .map(sortArrays)
      .map((item) => [JSON.stringify(item), item] as const)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, item]) => item);
  }
  if (tree !== null && typeof tree === "object") {
    return Object.fromEntries(
      Object.entries(tree).map(([k, v]) => [k, sortArrays(v)]),
    );
  }
  return tree;
}

function defineWholeBaselineChecks(write: boolean): void {
  it("covers every query on the app router, called or skipped with a reason", async () => {
    const covered = new Set([
      ...PROCEDURES.map((p) => p.path),
      ...Object.keys(SKIPPED),
    ]);
    // Before and after commits 28–31 land: their queries may still exist.
    const queries = (await routerQueries()).filter(
      (q) => !(q in DELETED_IN_V0100),
    );
    expect([...covered].sort()).toEqual(queries);
  });

  it("has one file per household and procedure, and no other", () => {
    if (write) return;
    const expected = new Set(HOUSEHOLDS.map((h) => h.key));
    const onDisk = fs.existsSync(BASELINE_DIR)
      ? fs.readdirSync(BASELINE_DIR)
      : [];
    expect(onDisk.sort()).toEqual([...expected].sort());
  });
}
