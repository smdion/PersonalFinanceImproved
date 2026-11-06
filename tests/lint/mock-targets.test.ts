/**
 * Every `vi.mock`/`vi.doMock` of a project path names a file that exists.
 * A mock of a moved or deleted module is a silent no-op: the test then runs
 * the real code. Paths through the `@/` alias and relative paths are
 * checked; package names are left to the resolver.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const TESTS = path.join(ROOT, "tests");
const SRC = path.join(ROOT, "src");
const SKIP_DIRS = new Set(["node_modules", "__baseline__", "__sync__"]);

/** `vi.mock("x"` / `vi.doMock('x'` / a backtick string with no `${`. */
const MOCK_CALL = /\bvi\.(?:mock|doMock)\(\s*(["'`])([^"'`$]+)\1/g;
const EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"];

function* walk(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) yield* walk(full);
    } else if (/\.[cm]?[jt]sx?$/.test(e.name)) yield full;
  }
}

/** The path a project specifier names, or undefined for a package. */
function projectPath(specifier: string, fromFile: string): string | undefined {
  if (specifier.startsWith("@/")) return path.join(SRC, specifier.slice(2));
  if (specifier.startsWith("./") || specifier.startsWith("../"))
    return path.resolve(path.dirname(fromFile), specifier);
  return undefined;
}

function resolves(target: string): boolean {
  const isFile = (p: string) => fs.existsSync(p) && fs.statSync(p).isFile();
  return [
    target,
    ...EXTENSIONS.map((ext) => target + ext),
    ...EXTENSIONS.map((ext) => path.join(target, `index${ext}`)),
  ].some(isFile);
}

/** Each `vi.mock`/`vi.doMock` string in `text`, with its line. */
function mockTargets(text: string): { specifier: string; line: number }[] {
  const out: { specifier: string; line: number }[] = [];
  for (const m of text.matchAll(MOCK_CALL)) {
    const before = text.slice(0, m.index);
    const lineStart = before.lastIndexOf("\n") + 1;
    if (/^\s*(\/\/|\*|\/\*)/.test(text.slice(lineStart, m.index))) continue;
    out.push({ specifier: m[2]!, line: before.split("\n").length });
  }
  return out;
}

describe("vi.mock targets", () => {
  it("every mocked project path resolves to a file", () => {
    let checked = 0;
    const missing: string[] = [];
    for (const file of walk(TESTS)) {
      // This file's own examples name paths that don't exist.
      if (file === __filename) continue;
      const text = fs.readFileSync(file, "utf8");
      for (const { specifier, line } of mockTargets(text)) {
        const target = projectPath(specifier, file);
        if (target === undefined) continue;
        checked++;
        if (!resolves(target))
          missing.push(`${path.relative(ROOT, file)}:${line} ${specifier}`);
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(missing).toEqual([]);
  });

  it("finds a mock across lines and skips comments and packages", () => {
    const text = [
      'vi.mock("@/lib/db");',
      "vi.doMock(",
      "  '../helpers/x',",
      ");",
      '// vi.mock("@/gone")',
      'vi.mock("next/navigation");',
    ].join("\n");
    expect(mockTargets(text)).toEqual([
      { specifier: "@/lib/db", line: 1 },
      { specifier: "../helpers/x", line: 2 },
      { specifier: "next/navigation", line: 6 },
    ]);
    expect(projectPath("next/navigation", __filename)).toBeUndefined();
    expect(resolves(path.join(SRC, "lib/db"))).toBe(true);
    expect(resolves(path.join(SRC, "lib/no-such-module"))).toBe(false);
  });
});
