/**
 * scripts/baseline-diff.ts turns a behavior-baseline rewrite into one line
 * per moved figure; scripts/vitest-failures.ts lists a benchmark timeout
 * apart from an assertion failure. Both on invented inputs.
 */
import { describe, it, expect } from "vitest";
import {
  changedLeaves,
  fileChanges,
  summaryLine,
} from "../../scripts/baseline-diff";
import { splitFailures, summary } from "../../scripts/vitest-failures";

describe("baseline-diff", () => {
  it("names each moved figure by household, procedure and field", () => {
    const before = JSON.stringify({
      result: { netWorth: 352000, fiTarget: 1320000 },
      portfolioAccounts: [{ amount: 260000 }, { amount: 22000 }],
    });
    const after = JSON.stringify({
      result: { netWorth: 352500, fiTarget: 1320000 },
      portfolioAccounts: [{ amount: 260000 }, { amount: 22500 }],
    });
    const lines = fileChanges(
      "tests/baseline/__baseline__/ws-h3/networth.computeSummary.json",
      before,
      after,
    ).map(summaryLine);
    expect(lines).toEqual([
      "household ws-h3, procedure networth.computeSummary, field portfolioAccounts[1].amount: $22,000 → $22,500",
      "household ws-h3, procedure networth.computeSummary, field result.netWorth: $352,000 → $352,500",
    ]);
  });

  it("shows a field that appears or goes, and a whole new file", () => {
    expect(changedLeaves({ a: 1 }, { a: 1, b: 2 })).toEqual([
      { field: "b", before: undefined, after: 2 },
    ]);
    const added = fileChanges(
      "tests/baseline/__baseline__/el-h1/new.query.json",
      null,
      "3",
    ).map(summaryLine);
    expect(added).toEqual([
      "household el-h1, procedure new.query, field (whole file): (none) → $3",
    ]);
  });

  it("finds nothing when the figures match", () => {
    expect(changedLeaves({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toEqual(
      [],
    );
  });
});

describe("vitest-failures", () => {
  it("lists a timeout apart from an assertion failure", () => {
    const failures = splitFailures({
      testResults: [
        {
          name: "/ci/tests/benchmarks/trinity-study.test.ts",
          assertionResults: [
            {
              fullName: "40yr horizon has lower success than 30yr",
              status: "failed",
              failureMessages: ["Error: Test timed out in 15000ms."],
            },
            {
              fullName: "4% SWR → 90-100% success",
              status: "failed",
              failureMessages: ["AssertionError: expected 0.8 to be >= 0.9"],
            },
            { fullName: "3% SWR → ~100% success", status: "passed" },
          ],
        },
      ],
    });
    expect(failures).toEqual({
      timedOut: [
        "tests/benchmarks/trinity-study.test.ts > 40yr horizon has lower success than 30yr",
      ],
      failed: [
        "tests/benchmarks/trinity-study.test.ts > 4% SWR → 90-100% success",
      ],
    });
    expect(summary(failures)).toContain(
      "### Timed out (unknown, not a figure): 1",
    );
  });
});
