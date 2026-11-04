/**
 * The engine hash covers the import closure of its entry points, so every
 * file that imports writeProjectionCache must be one: a writer reached
 * through a wrapper would otherwise drop out of the hash.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { entryPoints } from "../../scripts/engine-hash";

const CACHE_MODULE = "src/server/helpers/projection-cache.ts";

function sourceFiles(dir: string): string[] {
  return fs
    .readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((f) => path.posix.join(dir, f.split(path.sep).join("/")))
    .filter((f) => /\.tsx?$/.test(f));
}

describe("engine-hash entry points", () => {
  it("include every src/ importer of writeProjectionCache", () => {
    const importers = sourceFiles("src").filter(
      (f) =>
        f !== CACHE_MODULE &&
        /import[^;]*\bwriteProjectionCache\b[^;]*from/.test(
          fs.readFileSync(f, "utf8"),
        ),
    );
    expect(importers.length).toBeGreaterThan(0);
    const entries = entryPoints();
    expect(importers.filter((f) => !entries.includes(f))).toEqual([]);
  });

  it("include the Monte Carlo worker", () => {
    expect(entryPoints()).toContain("src/workers/monte-carlo-worker.ts");
  });
});
