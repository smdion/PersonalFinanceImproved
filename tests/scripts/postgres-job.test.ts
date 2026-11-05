/**
 * A PostgreSQL test runs only where CI's PostgreSQL job names it: the
 * SQLite run skips it (no TEST_DATABASE_URL), so a file the job doesn't
 * list runs nowhere.
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

describe("PostgreSQL job", () => {
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
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
    expect(
      postgresTests
        .map((file) => file.split(path.sep).join("/"))
        .filter((file) => !ci.includes(file)),
    ).toEqual([]);
  });
});
