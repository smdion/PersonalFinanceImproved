/**
 * docs/CALCULATIONS.md stays the register of every calculation (CI blocks
 * on this). It reads the doc with scripts/calculations-tested.ts's parser
 * and checks:
 *
 * 1. Every Function entry exists, with its symbol defined there.
 * 2. Every row names a Function and an Authority.
 * 3. Every value export of `src/lib/pure/` (the engine included) is named
 *    in some row's Function cell. The exports without a row today are
 *    listed in the baseline; that list may only
 *    shrink. A new export needs a row; a listed export that gets a row or
 *    goes away must leave the list (a stale entry fails too).
 * 4. Every row has a risk (H, M or L) in the baseline. High-risk rows with
 *    no independent test (no "independent" in the Test column) are listed
 *    too, and that list may only shrink the same way.
 *
 * The risk ratings come from the 2026-11-01 calculation-register review
 * (cost of being wrong × households affected × chance of failing
 * silently); CALCULATIONS.md has no Risk column yet. A new row is rated in
 * the same commit.
 *
 * Usage: tsx scripts/check-calculation-register.ts [--report]
 *   --report prints today's measured lists (to see what changed).
 */
import * as fs from "fs";
import * as path from "path";
import ts from "typescript";
import { fileURLToPath } from "url";
import {
  CALCULATIONS_DOC,
  functionRefs,
  missingPaths,
  registerRows,
  type RegisterRow,
} from "./calculations-tested";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const BASELINE_FILE = "scripts/calculation-register-baseline.json";
/** The directories whose exports must each have a row. */
export const COVERED_DIRS = ["src/lib/pure"];

export type Risk = "H" | "M" | "L";

export interface RegisterBaseline {
  /** Every row's risk, by id. */
  risk: Record<string, Risk>;
  /** High-risk rows with no independent test. May only shrink. */
  highRiskWithoutIndependentTest: string[];
  /** `src/…:symbol` exports with no row. May only shrink. */
  exportsWithoutRow: string[];
}

// ── Exports ─────────────────────────────────────────────────────────────

function exported(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    !!ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  );
}

/**
 * The value exports a module defines: functions, variables, classes and
 * enums. Types and interfaces aren't calculations; a re-export
 * (`export … from`) belongs to the module that defines it.
 */
export function valueExports(src: string, file = "module.ts"): string[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, false);
  const names: string[] = [];
  for (const s of sf.statements) {
    if (ts.isExportDeclaration(s)) {
      if (
        !s.moduleSpecifier &&
        !s.isTypeOnly &&
        s.exportClause &&
        ts.isNamedExports(s.exportClause)
      )
        for (const e of s.exportClause.elements)
          if (!e.isTypeOnly) names.push(e.name.text);
      continue;
    }
    if (!exported(s)) continue;
    if (ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s))
      names.push(s.name?.text ?? "default");
    else if (ts.isEnumDeclaration(s)) names.push(s.name.text);
    else if (ts.isVariableStatement(s))
      for (const d of s.declarationList.declarations)
        if (ts.isIdentifier(d.name)) names.push(d.name.text);
  }
  return names;
}

function* walk(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (/\.tsx?$/.test(e.name) && !/\.(test|d)\.tsx?$/.test(e.name))
      yield full;
  }
}

/** `src/…:symbol` for every value export under the covered directories. */
export function coveredExports(root = ROOT): string[] {
  return COVERED_DIRS.flatMap((dir) =>
    [...walk(path.join(root, dir))].flatMap((f) => {
      const rel = path.relative(root, f).split(path.sep).join("/");
      return valueExports(fs.readFileSync(f, "utf8"), f).map(
        (name) => `${rel}:${name}`,
      );
    }),
  ).sort();
}

// ── The checks ──────────────────────────────────────────────────────────

const INDEPENDENT = /(?<!not )\bindependent\b/i;

/** What the register and the code say today. */
export interface Measured {
  highRiskWithoutIndependentTest: string[];
  exportsWithoutRow: string[];
}

export function measure(
  rows: RegisterRow[],
  doc: string,
  exports: string[],
  risk: Record<string, Risk>,
): Measured {
  const named = new Set(
    functionRefs(doc)
      .filter((r) => r.file && r.symbol)
      .map((r) => `${r.file}:${r.symbol}`),
  );
  return {
    highRiskWithoutIndependentTest: rows
      .filter(
        (r) =>
          risk[r.cells.Id!] === "H" && !INDEPENDENT.test(r.cells.Test ?? ""),
      )
      .map((r) => r.cells.Id!)
      .sort(),
    exportsWithoutRow: exports.filter((e) => !named.has(e)).sort(),
  };
}

/** A shrink-only list against today's set: new entries and stale ones. */
function shrinkOnly(
  listed: string[],
  today: string[],
  what: { added: string; stale: string },
): string[] {
  const was = new Set(listed);
  const now = new Set(today);
  return [
    ...today.filter((x) => !was.has(x)).map((x) => `${x}: ${what.added}`),
    ...listed.filter((x) => !now.has(x)).map((x) => `${x}: ${what.stale}`),
  ];
}

/** Every problem with the register against the baseline (empty = pass). */
export function registerProblems(
  doc: string,
  exports: string[],
  baseline: RegisterBaseline,
): string[] {
  const rows = registerRows(doc);
  const problems: string[] = [];
  const ids = new Set(rows.map((r) => r.cells.Id!));
  for (const { line, cells } of rows)
    for (const col of ["Function", "Authority"])
      if (!(cells[col] ?? "").trim())
        problems.push(`${cells.Id} (line ${line}): no ${col}`);
  for (const id of ids)
    if (!["H", "M", "L"].includes(baseline.risk[id] ?? ""))
      problems.push(
        `${id}: no risk (H, M or L) in ${BASELINE_FILE} — rate the new row`,
      );
  for (const id of Object.keys(baseline.risk))
    if (!ids.has(id))
      problems.push(
        `${id}: rated in ${BASELINE_FILE} but not a row — remove its rating`,
      );
  const today = measure(rows, doc, exports, baseline.risk);
  problems.push(
    ...shrinkOnly(
      baseline.highRiskWithoutIndependentTest,
      today.highRiskWithoutIndependentTest,
      {
        added:
          "a high-risk row with no independent test — add one (an expected value worked without running Ledgr)",
        stale: `no longer a high-risk row without an independent test — remove it from highRiskWithoutIndependentTest in ${BASELINE_FILE}`,
      },
    ),
    ...shrinkOnly(baseline.exportsWithoutRow, today.exportsWithoutRow, {
      added: `exported with no row in ${CALCULATIONS_DOC} — add a row naming it (or don't export it)`,
      stale: `now has a row or isn't exported — remove it from exportsWithoutRow in ${BASELINE_FILE}`,
    }),
  );
  return problems;
}

// ── CLI ─────────────────────────────────────────────────────────────────

function main() {
  const doc = fs.readFileSync(path.join(ROOT, CALCULATIONS_DOC), "utf8");
  const baseline = JSON.parse(
    fs.readFileSync(path.join(ROOT, BASELINE_FILE), "utf8"),
  ) as RegisterBaseline;
  const exports = coveredExports();
  if (process.argv.includes("--report")) {
    console.log(
      JSON.stringify(
        measure(registerRows(doc), doc, exports, baseline.risk),
        null,
        2,
      ),
    );
    return;
  }
  const problems = [
    ...missingPaths(doc),
    ...registerProblems(doc, exports, baseline),
  ];
  if (problems.length) {
    console.error(
      `FAIL: calculation register (${CALCULATIONS_DOC}, ${BASELINE_FILE})\n  ${problems.join("\n  ")}`,
    );
    process.exit(1);
  }
  const byDir = COVERED_DIRS.map(
    (d) =>
      `${d}: ${baseline.exportsWithoutRow.filter((e) => e.startsWith(`${d}/`)).length} of ${exports.filter((e) => e.startsWith(`${d}/`)).length}`,
  );
  console.log(
    `PASS: calculation register. Exports with no row (may only shrink): ${byDir.join("; ")}. High-risk rows with no independent test: ${baseline.highRiskWithoutIndependentTest.length}.`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
