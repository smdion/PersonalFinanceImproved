/**
 * Test files that run only where a CI job names them: a PostgreSQL test
 * (the SQLite run skips it: no TEST_DATABASE_URL) and a benchmark (the
 * benchmarks job runs its groups by file). A file the job doesn't list
 * runs nowhere.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function testFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return testFiles(full);
    return /\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const unlisted = (files: string[]) =>
  files
    .map((file) => file.split(path.sep).join("/"))
    .filter((file) => !ci.includes(file));

describe("PostgreSQL job", () => {
  const postgresTests = testFiles("tests").filter(
    (file) =>
      file.endsWith("-postgres.test.ts") ||
      /from "[./]*\/?(routers\/)?setup-postgres"/.test(
        readFileSync(file, "utf8"),
      ),
  );

  it("finds the PostgreSQL tests", () => {
    expect(postgresTests.length).toBeGreaterThan(0);
  });

  it("names every PostgreSQL test file in ci.yml", () => {
    expect(unlisted(postgresTests)).toEqual([]);
  });
});

describe("benchmarks job", () => {
  const benchmarks = testFiles("tests/benchmarks");

  it("finds the benchmarks", () => {
    expect(benchmarks.length).toBeGreaterThan(0);
  });

  it("puts every benchmark file in a group in ci.yml", () => {
    expect(unlisted(benchmarks)).toEqual([]);
  });
});
