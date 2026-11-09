/**
 * scripts/check-router-postgres.ts: the router suite's PostgreSQL run
 * passes only when its failures are exactly the known list.
 */
import { describe, expect, it } from "vitest";
import {
  compare,
  outcomes,
  type Known,
} from "../../scripts/check-router-postgres";

const root = "/repo";
const report = (tests: [string, string, string][], broken: string[] = []) => ({
  testResults: [
    ...tests.map(([file, title, status]) => ({
      name: `${root}/${file}`,
      status,
      assertionResults: [{ ancestorTitles: ["router"], title, status }],
    })),
    ...broken.map((file) => ({
      name: `${root}/${file}`,
      status: "failed",
      message: "Cannot find module",
      assertionResults: [],
    })),
  ],
});
const known: Known = {
  reasons: { decimal: "numeric text" },
  failures: { "tests/routers/a.test.ts > router > pins 300": "decimal" },
};

function check(r: ReturnType<typeof report>, k: Known = known): string[] {
  const { tests, brokenFiles } = outcomes(r, root);
  return compare(k, tests, brokenFiles);
}

describe("check-router-postgres", () => {
  it("passes when the failures are the known ones", () => {
    expect(
      check(
        report([
          ["tests/routers/a.test.ts", "pins 300", "failed"],
          ["tests/routers/a.test.ts", "writes", "passed"],
        ]),
      ),
    ).toEqual([]);
  });

  it("fails on a new failure, a listed test that passed or didn't run, and a file that didn't run", () => {
    expect(
      check(report([["tests/routers/a.test.ts", "writes", "failed"]])),
    ).toEqual([
      "new failure on PostgreSQL: tests/routers/a.test.ts > router > writes",
      "listed but didn't run: tests/routers/a.test.ts > router > pins 300",
    ]);
    expect(
      check(report([["tests/routers/a.test.ts", "pins 300", "passed"]])),
    ).toEqual([
      "listed but passed (remove it from tests/routers/postgres-known-failures.json): tests/routers/a.test.ts > router > pins 300",
    ]);
    expect(
      check(
        report(
          [["tests/routers/a.test.ts", "pins 300", "failed"]],
          ["tests/routers/b.test.ts"],
        ),
      ),
    ).toEqual([
      "file failed to run: tests/routers/b.test.ts: Cannot find module",
    ]);
  });

  it("fails on an entry whose reason isn't stated", () => {
    expect(
      check(report([["tests/routers/a.test.ts", "pins 300", "failed"]]), {
        reasons: {},
        failures: known.failures,
      }),
    ).toEqual([
      'listed with no stated reason "decimal": tests/routers/a.test.ts > router > pins 300',
    ]);
  });
});
