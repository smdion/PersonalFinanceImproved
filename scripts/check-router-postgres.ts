/**
 * The router suite's run on PostgreSQL (CI's PostgreSQL job, part
 * `routers`) against its known failures, tests/routers/
 * postgres-known-failures.json: every test that failed must be listed, and
 * every listed test must have run and failed. The list only shrinks: a fix
 * removes its entry in the same commit.
 *
 * Usage: pnpm tsx scripts/check-router-postgres.ts [<vitest json report>]
 * With no report it runs the suite itself (LEDGR_ROUTER_DIALECT=postgres;
 * TEST_DATABASE_URL must name a throwaway `_test` database): every
 * tests/routers/ file but the PostgreSQL and SQLite tests that run elsewhere.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const KNOWN = "tests/routers/postgres-known-failures.json";

type Report = {
  testResults: {
    name: string;
    status: string;
    message?: string;
    assertionResults: {
      ancestorTitles: string[];
      title: string;
      status: string;
    }[];
  }[];
};

export type Known = {
  reasons: Record<string, string>;
  failures: Record<string, string>;
};

/** Each test's outcome by "<file> > <describe> > … > <title>", and the
 *  files that failed without running their tests. */
export function outcomes(report: Report, root: string) {
  const tests = new Map<string, string>();
  const brokenFiles: string[] = [];
  for (const file of report.testResults) {
    const rel = path.relative(root, file.name).split(path.sep).join("/");
    if (file.status === "failed" && file.assertionResults.length === 0)
      brokenFiles.push(`${rel}: ${file.message ?? "failed to run"}`);
    for (const t of file.assertionResults)
      tests.set([rel, ...t.ancestorTitles, t.title].join(" > "), t.status);
  }
  return { tests, brokenFiles };
}

/** What doesn't match the list: new failures, listed tests that passed or
 *  didn't run, entries with no reason, and files that didn't run. */
export function compare(
  known: Known,
  tests: Map<string, string>,
  brokenFiles: string[],
): string[] {
  const problems = brokenFiles.map((f) => `file failed to run: ${f}`);
  for (const [name, status] of tests)
    if (status === "failed" && !(name in known.failures))
      problems.push(`new failure on PostgreSQL: ${name}`);
  for (const [name, reason] of Object.entries(known.failures)) {
    if (!(reason in known.reasons))
      problems.push(`listed with no stated reason "${reason}": ${name}`);
    const status = tests.get(name);
    if (status === undefined) problems.push(`listed but didn't run: ${name}`);
    else if (status !== "failed")
      problems.push(`listed but ${status} (remove it from ${KNOWN}): ${name}`);
  }
  return problems;
}

/** The suite's files: the PostgreSQL tests and the SQLite fresh install
 *  run in their own parts, the lock test needs no database. */
function routerFiles(): string[] {
  return fs
    .readdirSync("tests/routers")
    .filter(
      (f) =>
        f.endsWith(".test.ts") &&
        !f.endsWith("-postgres.test.ts") &&
        f !== "fresh-install.test.ts" &&
        f !== "test-database-lock.test.ts",
    )
    .map((f) => `tests/routers/${f}`);
}

/** Run the suite on PostgreSQL; the path of its JSON report. Its failures
 *  are judged against the list, not by vitest's exit code. */
function runSuite(): string {
  const report = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "router-postgres-")),
    "report.json",
  );
  spawnSync(
    "pnpm",
    [
      "vitest",
      "run",
      "--project=node",
      ...routerFiles(),
      "--reporter=default",
      "--reporter=json",
      `--outputFile=${report}`,
    ],
    {
      stdio: "inherit",
      env: { ...process.env, LEDGR_ROUTER_DIALECT: "postgres" },
    },
  );
  return report;
}

function main(): void {
  const reportFile = process.argv[2] ?? runSuite();
  if (!fs.existsSync(reportFile)) {
    console.error(`No vitest JSON report at ${reportFile}`);
    process.exit(1);
  }
  const report = JSON.parse(fs.readFileSync(reportFile, "utf8")) as Report;
  const known = JSON.parse(fs.readFileSync(KNOWN, "utf8")) as Known;
  const { tests, brokenFiles } = outcomes(report, process.cwd());
  const problems = compare(known, tests, brokenFiles);
  const failed = [...tests.values()].filter((s) => s === "failed").length;
  console.log(
    `${tests.size} router tests on PostgreSQL, ${failed} failed, ${Object.keys(known.failures).length} known.`,
  );
  if (problems.length > 0) {
    for (const p of problems) console.error(p);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
