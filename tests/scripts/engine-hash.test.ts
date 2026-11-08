/**
 * The engine hash covers the import closure of its entry points, so every
 * file that imports writeProjectionCache must be one: a writer reached
 * through a wrapper would otherwise drop out of the hash. The cache module
 * is found by what it exports, so it may move. Each file is hashed as its
 * code without comments (owner v0.10.3 Q2), so a comment-only change keeps
 * every cached projection.
 */
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  cacheModule,
  closure,
  codeOf,
  entryPoints,
  foldHash,
} from "../../scripts/engine-hash";
import { ENGINE_HASH } from "../../src/lib/generated/engine-hash";

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

describe("engine-hash reads code, not comments (owner v0.10.3 Q2)", () => {
  const code = [
    'import { round } from "./math";',
    "",
    "/** The year's draw. */",
    "export function draw(need: number, rate: number): number {",
    "  // Grossed up for tax.",
    "  const gross = need / (1 - rate);",
    "  return round(gross, `${need} // not a comment`);",
    "}",
  ].join("\n");
  const same = (a: string, b: string) =>
    expect(codeOf("src/a.ts", b)).toBe(codeOf("src/a.ts", a));
  const differs = (a: string, b: string) =>
    expect(codeOf("src/a.ts", b)).not.toBe(codeOf("src/a.ts", a));

  it("keeps a file's code through any comment edit", () => {
    same(code, code.replace("Grossed up for tax.", "Grossed up: tax first."));
    same(code, code.replace("  // Grossed up for tax.\n", ""));
    same(
      code,
      code.replace("/** The year's draw. */", "/**\n * The draw.\n */"),
    );
    same(code, code.replace("rate);", "rate); // the marginal rate"));
    same(code, code.replace("(1 - rate)", "(1 /* gross */ - rate)"));
    same(code, `// header\n${code}\n/* trailer */\n`);
    same(code, code.replace("  const gross", "    const gross"));
  });

  it("changes with any code edit, a `//` inside a string included", () => {
    differs(code, code.replace("1 - rate", "1 + rate"));
    differs(code, code.replace("not a comment", "not a remark"));
    differs(code, code.replace("rate: number)", "rate: number, _x = 0)"));
    differs(code, code.replace('"./math"', '"./math2"'));
    // A line break can end a statement, so it counts.
    differs("let a = b\n(c)", "let a = b (c)");
  });

  it("hashes the engine's files the same with their comments changed, and differently with code changed", async () => {
    const files = (await closure()).map((p) => ({
      path: p,
      text: fs.readFileSync(p, "utf8"),
    }));
    expect(files.length).toBeGreaterThan(100);
    // The committed key is this hash (check:engine-hash also holds it).
    expect(foldHash(files)).toBe(ENGINE_HASH);
    const edit = (change: (text: string) => string) =>
      foldHash(
        files.map((f, i) => (i === 0 ? { ...f, text: change(f.text) } : f)),
      );
    expect(edit((t) => `// A new comment.\n${t}`)).toBe(ENGINE_HASH);
    expect(edit((t) => `${t}\n/** A trailing doc comment. */\n`)).toBe(
      ENGINE_HASH,
    );
    expect(edit((t) => `${t}\nexport const __probe = 1;\n`)).not.toBe(
      ENGINE_HASH,
    );
  });

  it("hashes the formatters the engine reads, not lib/utils/format.ts: a display-only edit there keeps ENGINE_HASH", async () => {
    const paths = await closure();
    expect(paths).not.toContain("src/lib/utils/format.ts");
    expect(paths).toEqual(
      expect.arrayContaining([
        "src/lib/utils/percent.ts",
        "src/lib/utils/account-name.ts",
      ]),
    );
  });
});
