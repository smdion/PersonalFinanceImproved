/**
 * Every no-input query the dashboard shell loads (sidebar, header, the
 * hooks they use) is prefetched with each page — prefetchShellQueries in
 * server/helpers/server-trpc.ts — and nothing else is. A shell query the
 * server doesn't load is cached in the browser before a page's section
 * hydrates, so a page reading it renders differently on the server
 * (a hydration mismatch).
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SRC = path.resolve(__dirname, "../../src");
const SHELL_ROOTS = [
  "app/(dashboard)/layout.tsx",
  "app/(dashboard)/dashboard-shell.tsx",
];
const HELPER = path.join(SRC, "server/helpers/server-trpc.ts");

function resolve(from: string, spec: string): string | null {
  const base = spec.startsWith("@/")
    ? path.join(SRC, spec.slice(2))
    : spec.startsWith(".")
      ? path.resolve(path.dirname(from), spec)
      : null;
  if (!base) return null;
  for (const c of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ])
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  return null;
}

/** Client files the shell renders, following imports (not into the server). */
function shellFiles(): string[] {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const m of fs.readFileSync(file, "utf8").matchAll(/from "([^"]+)"/g)) {
      const next = resolve(file, m[1]!);
      if (next && !next.includes(`${path.sep}server${path.sep}`)) visit(next);
    }
  };
  for (const r of SHELL_ROOTS) visit(path.join(SRC, r));
  return [...seen];
}

describe("shell queries are prefetched with every page", () => {
  it("prefetchShellQueries lists exactly the shell's no-input queries", () => {
    const loaded = new Set<string>();
    for (const file of shellFiles())
      for (const m of fs
        .readFileSync(file, "utf8")
        .matchAll(/trpc\.([\w.]+)\.useQuery\(\s*(?:\)|undefined)/g))
        loaded.add(m[1]!);

    const helper = fs.readFileSync(HELPER, "utf8");
    const body = helper.slice(
      helper.indexOf("function prefetchShellQueries"),
      helper.indexOf("export async function prefetchForPage"),
    );
    const prefetched = new Set(
      [...body.matchAll(/h\.([\w.]+)\.prefetch\(\)/g)].map((m) => m[1]!),
    );

    expect(loaded.size).toBeGreaterThan(0);
    expect([...prefetched].sort()).toEqual([...loaded].sort());
  });
});
