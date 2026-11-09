/**
 * A vitest JSON report's failures, split by kind: a test that timed out
 * says nothing about its assertion (a busy runner, not a wrong figure),
 * so it is reported apart from a test whose assertion failed. CI's
 * benchmark job prints this to the job summary when a group fails; a
 * timeout is rerun once and stays "unknown", never a pass.
 *
 * Usage: tsx scripts/vitest-failures.ts <report.json>
 *   Exits 1 when any test failed, either kind.
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

interface AssertionResult {
  fullName: string;
  status: string;
  failureMessages?: string[];
}
interface Report {
  testResults: { name: string; assertionResults: AssertionResult[] }[];
}

export interface Failures {
  timedOut: string[];
  failed: string[];
}

const TIMED_OUT = /Test timed out in \d+ms/;

/** The report's failed tests, timeouts apart from assertion failures. */
export function splitFailures(report: Report): Failures {
  const out: Failures = { timedOut: [], failed: [] };
  for (const file of report.testResults)
    for (const t of file.assertionResults) {
      if (t.status !== "failed") continue;
      const name = `${file.name.replace(/^.*?tests\//, "tests/")} > ${t.fullName}`;
      if ((t.failureMessages ?? []).some((m) => TIMED_OUT.test(m)))
        out.timedOut.push(name);
      else out.failed.push(name);
    }
  return out;
}

/** The summary as markdown. */
export function summary({ timedOut, failed }: Failures): string {
  const list = (names: string[]) => names.map((n) => `- ${n}`).join("\n");
  return [
    `### Assertion failures: ${failed.length}`,
    list(failed),
    `### Timed out (unknown, not a figure): ${timedOut.length}`,
    list(timedOut),
  ]
    .filter(Boolean)
    .join("\n");
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: tsx scripts/vitest-failures.ts <report.json>");
    process.exit(2);
  }
  const failures = splitFailures(
    JSON.parse(fs.readFileSync(file, "utf8")) as Report,
  );
  console.log(summary(failures));
  if (failures.failed.length + failures.timedOut.length > 0) process.exit(1);
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
)
  main();
