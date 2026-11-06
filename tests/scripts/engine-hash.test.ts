/**
 * The engine hash covers the import closure of its entry points, so every
 * file that imports writeProjectionCache must be one: a writer reached
 * through a wrapper would otherwise drop out of the hash. The cache module
 * is found by what it exports, so it may move.
 */
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { cacheModule, entryPoints } from "../../scripts/engine-hash";

function sourceFiles(dir: string): string[] {
  return fs
    .readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((f) => path.posix.join(dir, f.split(path.sep).join("/")))
    .filter((f) => /\.tsx?$/.test(f));
}

describe("engine-hash entry points", () => {
  it("include every src/ importer of writeProjectionCache", () => {
    const cache = cacheModule();
    const importers = sourceFiles("src").filter(
      (f) =>
        f !== cache &&
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

  it("find the cache module at any path, and leave it out", () => {
    const root = fs.mkdtempSync(path.join(tmpdir(), "engine-hash-"));
    try {
      const write = (file: string, text: string) => {
        fs.mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), text);
      };
      const cache = "src/server/services/cache/projection-store.ts";
      write(
        cache,
        "export const PROJECTION_CACHE_ENGINE_VERSION = 1;\nexport function writeProjectionCache() {}\nwriteProjectionCache();\n",
      );
      write(
        "src/server/routers/plan.ts",
        'import { writeProjectionCache } from "../services/cache/projection-store";\nwriteProjectionCache();\n',
      );
      expect(cacheModule(root)).toBe(cache);
      expect(entryPoints(root)).toEqual([
        "src/server/routers/plan.ts",
        "src/workers/monte-carlo-worker.ts",
      ]);
      write(
        "src/copy.ts",
        "export const PROJECTION_CACHE_ENGINE_VERSION = 2;\n",
      );
      expect(() => cacheModule(root)).toThrow(/found 2/);
    } finally {
      if (root.startsWith(tmpdir())) fs.rmSync(root, { recursive: true });
    }
  });
});
