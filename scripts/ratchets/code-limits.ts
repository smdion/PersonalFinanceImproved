/**
 * The ratchets written in code: page budgets in check-bundle-size.ts, the
 * coverage thresholds and excludes in vitest.config.ts, and the known lists
 * in the lint and baseline tests. Each is read with the TypeScript parser.
 */
import ts from "typescript";
import type { Rise, Tree } from "./rise";

export const BUNDLE_FILE = "scripts/check-bundle-size.ts";
export const COVERAGE_FILE = "vitest.config.ts";
export const LIST_FILES = [
  "tests/lint/violations.test.ts",
  "tests/baseline/router-baseline-postgres.test.ts",
];
/** Top-level consts in LIST_FILES that hold a shrink-only list. */
const LIST_NAME = /EXEMPT|KNOWN|BUILT_AT_LOAD/;

function parse(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
}

function propName(name: ts.PropertyName): string | undefined {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name)
  )
    return name.text;
  return undefined;
}

/** The numeric properties of an object literal, flattened to `a.b`. */
function numbers(node: ts.Expression, prefix = ""): Record<string, number> {
  const out: Record<string, number> = {};
  if (!ts.isObjectLiteralExpression(node)) return out;
  for (const prop of node.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const name = propName(prop.name);
    if (name === undefined) continue;
    const init = prop.initializer;
    if (ts.isNumericLiteral(init)) out[prefix + name] = Number(init.text);
    else Object.assign(out, numbers(init, `${prefix}${name}.`));
  }
  return out;
}

/** Every `name: <value>` property in the file, in source order. */
function properties(sf: ts.SourceFile, name: string): ts.Expression[] {
  const found: ts.Expression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && propName(node.name) === name)
      found.push(node.initializer);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** Top-level `const NAME = <value>` initializers, by name. */
function topConsts(sf: ts.SourceFile): Map<string, ts.Expression> {
  const out = new Map<string, ts.Expression>();
  for (const stmt of sf.statements)
    if (ts.isVariableStatement(stmt))
      for (const decl of stmt.declarationList.declarations)
        if (ts.isIdentifier(decl.name) && decl.initializer)
          out.set(decl.name.text, decl.initializer);
  return out;
}

/** Page budgets, the default budget and the chunk limit never rise. */
export function bundleRises(
  base: string,
  head: string,
  headTree: Tree,
): Rise[] {
  const read = (text: string) => {
    const consts = topConsts(parse(BUNDLE_FILE, text));
    const value = (name: string) => {
      const init = consts.get(name);
      return init && ts.isNumericLiteral(init) ? Number(init.text) : undefined;
    };
    const pages = consts.get("PAGE_BUDGET_KB");
    return {
      pages: pages ? numbers(pages) : {},
      fallback: value("DEFAULT_PAGE_BUDGET_KB") ?? Infinity,
      chunk: value("CHUNK_ERROR_KB") ?? Infinity,
    };
  };
  const was = read(base);
  const now = read(head);
  const rises: Rise[] = [];
  const say = (text: string) => rises.push({ file: BUNDLE_FILE, text });
  if (now.fallback > was.fallback)
    say(`DEFAULT_PAGE_BUDGET_KB ${was.fallback} → ${now.fallback}`);
  if (now.chunk > was.chunk) say(`CHUNK_ERROR_KB ${was.chunk} → ${now.chunk}`);
  const pageExists = (route: string) =>
    [".tsx", ".ts", ".jsx", ".js"].some(
      (ext) => headTree(`src/app${route}${ext}`) !== undefined,
    );
  for (const [route, kb] of Object.entries(was.pages)) {
    const budget = now.pages[route] ?? (pageExists(route) ? now.fallback : 0);
    if (budget > kb) say(`${route}: budget ${kb} → ${budget} KB`);
  }
  for (const [route, kb] of Object.entries(now.pages))
    if (!(route in was.pages) && kb > was.fallback)
      say(`${route}: new budget ${kb} KB, over the default ${was.fallback}`);
  return rises;
}

/** Coverage thresholds never fall; the coverage excludes only shrink. */
export function coverageRises(
  base: string,
  head: string,
  moves: Map<string, string>,
): Rise[] {
  const read = (text: string) => {
    const sf = parse(COVERAGE_FILE, text);
    const thresholds = Object.assign(
      {},
      ...properties(sf, "thresholds").map((node) => numbers(node)),
    ) as Record<string, number>;
    const exclude = new Set<string>();
    for (const coverage of properties(sf, "coverage"))
      if (ts.isObjectLiteralExpression(coverage))
        for (const prop of coverage.properties)
          if (
            ts.isPropertyAssignment(prop) &&
            propName(prop.name) === "exclude" &&
            ts.isArrayLiteralExpression(prop.initializer)
          )
            for (const el of prop.initializer.elements)
              if (ts.isStringLiteralLike(el)) exclude.add(el.text);
    return { thresholds, exclude };
  };
  const was = read(base);
  const now = read(head);
  const rises: Rise[] = [];
  for (const [key, value] of Object.entries(was.thresholds)) {
    const after = now.thresholds[key];
    if (after === undefined || after < value)
      rises.push({
        file: COVERAGE_FILE,
        text: `coverage threshold ${key}: ${value} → ${after ?? "removed"}`,
      });
  }
  for (const entry of now.exclude) {
    const from = moves.get(entry);
    if (
      was.exclude.has(entry) ||
      (from && was.exclude.has(from) && !now.exclude.has(from))
    )
      continue;
    rises.push({
      file: COVERAGE_FILE,
      text: `coverage exclude added: ${entry}`,
    });
  }
  return rises;
}

/**
 * The entries of each shrink-only list, `LIST › key` with nested keys joined
 * by ` › `: a count when the entry has one, else undefined (present or not).
 * A list is a top-level const named like LIST_NAME, or an `additionalExempt:`
 * inside a named function.
 */
export function listEntries(
  file: string,
  text: string,
): Map<string, number | undefined> {
  const entries = new Map<string, number | undefined>();
  const walk = (node: ts.Node, prefix: string) => {
    if (ts.isObjectLiteralExpression(node)) {
      for (const prop of node.properties) {
        if (!ts.isPropertyAssignment(prop) || !ts.isStringLiteral(prop.name)) {
          ts.forEachChild(prop, (child) => walk(child, prefix));
          continue;
        }
        const key = `${prefix} › ${prop.name.text}`;
        entries.set(key, numbers(prop.initializer).count);
        walk(prop.initializer, key);
      }
      return;
    }
    if (ts.isArrayLiteralExpression(node)) {
      for (const el of node.elements)
        if (ts.isStringLiteralLike(el))
          entries.set(`${prefix} › ${el.text}`, undefined);
        else walk(el, prefix);
      return;
    }
    ts.forEachChild(node, (child) => walk(child, prefix));
  };
  const sf = parse(file, text);
  for (const [name, init] of topConsts(sf))
    if (LIST_NAME.test(name)) walk(init, name);
  const visit = (node: ts.Node, fn: string) => {
    const here =
      ts.isFunctionDeclaration(node) && node.name ? node.name.text : fn;
    if (
      ts.isPropertyAssignment(node) &&
      propName(node.name) === "additionalExempt"
    )
      walk(node.initializer, `${here}.additionalExempt`);
    else ts.forEachChild(node, (child) => visit(child, here));
  };
  visit(sf, "(top level)");
  return entries;
}

/**
 * No list gains an entry or a count. An entry whose path moved (its first
 * word is a file the move map traces back to the old entry's file) is the
 * old entry; counts of entries that trace to one old entry are summed.
 */
export function listRises(
  file: string,
  base: string,
  head: string,
  moves: Map<string, string>,
): Rise[] {
  const was = listEntries(file, base);
  const now = listEntries(file, head);
  const traced = (entry: string) => {
    if (was.has(entry)) return entry;
    const [list = "", ...rest] = entry.split(" › ");
    const [first = "", ...words] = rest.join(" › ").split(" ");
    const seen = new Set<string>();
    for (
      let from = moves.get(first);
      from && !seen.has(from);
      from = moves.get(from)
    ) {
      seen.add(from);
      const old = `${list} › ${[from, ...words].join(" ")}`;
      if (was.has(old)) return old;
    }
    return entry;
  };
  const sums = new Map<string, number>();
  const rises: Rise[] = [];
  for (const [entry, count] of now) {
    const key = traced(entry);
    if (!was.has(key)) {
      rises.push({ file, text: `${entry}: added` });
      continue;
    }
    if (count !== undefined) sums.set(key, (sums.get(key) ?? 0) + count);
  }
  for (const [key, count] of sums) {
    const before = was.get(key) ?? 0;
    if (count > before)
      rises.push({ file, text: `${key}: ${before} → ${count}` });
  }
  return rises;
}
