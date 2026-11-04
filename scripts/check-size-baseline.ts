/**
 * Size ratchet over src/ (CI blocks on it). size-baseline.json records every
 * file over FILE_LIMIT lines and every function over FUNCTION_LIMIT lines at
 * its length; a recorded entry never grows and is lowered when it shrinks.
 * An unrecorded file over FILE_LIMIT fails. New long functions are caught by
 * ESLint's max-lines-per-function. `--update` lowers entries, never raises.
 * `--record <file>…` records each part of a split at its size, so a part
 * can't regrow to the limit; a file over the limit can't be recorded.
 */
import * as fs from "fs";
import * as path from "path";
import ts from "typescript";

const FILE_LIMIT = 400;
const FUNCTION_LIMIT = 150;
const BASELINE_PATH = "size-baseline.json";
const SRC_DIR = "src";
// Generated from the PostgreSQL schema by scripts/gen-sqlite-schema.ts.
const GENERATED = [
  /^src\/lib\/db\/sqlite\//,
  /^src\/lib\/db\/schema-sqlite\.ts$/,
];

type Baseline = {
  files: Record<string, number>;
  functions: Record<string, Record<string, number>>;
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry.name))
      out.push(full.split(path.sep).join("/"));
  }
  return out;
}

/** Same count as `wc -l`. */
function countLines(text: string): number {
  const lines = text.split("\n").length;
  return text.endsWith("\n") ? lines - 1 : lines;
}

function nameText(name: ts.Node | undefined): string | undefined {
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return undefined;
}

/** The name an ancestor gives to the functions inside it, if any. */
function segmentOf(node: ts.Node): string | undefined {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isVariableDeclaration(node) ||
    ts.isPropertyAssignment(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  ) {
    return nameText(node.name) ?? "default";
  }
  if (ts.isConstructorDeclaration(node)) return "constructor";
  if (ts.isExportAssignment(node)) return "default";
  if (ts.isJsxAttribute(node)) return node.name.getText();
  if (ts.isFunctionExpression(node) && node.name) return node.name.text;
  if (
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    ts.isParenthesizedExpression(node.parent) &&
    ts.isCallExpression(node.parent.parent) &&
    node.parent.parent.expression === node.parent
  ) {
    return "iife()";
  }
  // A callback: name it by the call it is passed to.
  if (
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    ts.isCallExpression(node.parent) &&
    node.parent.arguments.some((arg) => arg === node)
  ) {
    const callee = node.parent.expression;
    if (ts.isIdentifier(callee)) return `${callee.text}()`;
    if (ts.isPropertyAccessExpression(callee)) return `${callee.name.text}()`;
    return "call()";
  }
  return undefined;
}

function isFunctionNode(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

/**
 * Every function over FUNCTION_LIMIT in the file, keyed by its dotted path,
 * with its length. Same-named ones are numbered in source order.
 */
function functionLengths(file: string, text: string): Map<string, number> {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
  const lengths = new Map<string, number>();
  const visit = (node: ts.Node, segments: string[]) => {
    const segment = segmentOf(node);
    const here = segment ? [...segments, segment] : segments;
    if (isFunctionNode(node) && node.body) {
      const start = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
      const end = sf.getLineAndCharacterOfPosition(node.getEnd()).line;
      const lines = end - start + 1;
      if (lines > FUNCTION_LIMIT) {
        const base = here.join(".") || "anonymous";
        let key = base;
        for (let n = 2; lengths.has(key); n++) key = `${base} #${n}`;
        lengths.set(key, lines);
      }
    }
    ts.forEachChild(node, (child) => visit(child, here));
  };
  visit(sf, []);
  return lengths;
}

function measure(): Baseline {
  const measured: Baseline = { files: {}, functions: {} };
  for (const file of walk(SRC_DIR).sort()) {
    if (GENERATED.some((re) => re.test(file))) continue;
    const text = fs.readFileSync(file, "utf8");
    measured.files[file] = countLines(text);
    const fns: Record<string, number> = {};
    for (const [name, lines] of functionLengths(file, text)) fns[name] = lines;
    measured.functions[file] = fns;
  }
  return measured;
}

function readBaseline(): Baseline {
  if (!fs.existsSync(BASELINE_PATH)) return { files: {}, functions: {} };
  return JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")) as Baseline;
}

function sortKeys<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).sort(([a], [b]) => a.localeCompare(b)),
  );
}

function writeBaseline(baseline: Baseline) {
  const out: Baseline = {
    files: sortKeys(baseline.files),
    functions: sortKeys(
      Object.fromEntries(
        Object.entries(baseline.functions).map(([f, fns]) => [
          f,
          sortKeys(fns),
        ]),
      ),
    ),
  };
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(out, null, 2)}\n`);
}

const GROW = "split it; never raise the baseline";
const SHRINK = "lower the baseline (pnpm check:file-size --update)";
const GONE =
  "remove the entry (pnpm check:file-size --update); after a split, record each part at its size";
const FN_GONE = `not found or now ${FUNCTION_LIMIT} lines or under — remove the entry (pnpm check:file-size --update)`;

function check(baseline: Baseline, measured: Baseline): string[] {
  const failures: string[] = [];
  for (const [file, lines] of Object.entries(measured.files)) {
    const recorded = baseline.files[file];
    if (recorded === undefined) {
      if (lines > FILE_LIMIT)
        failures.push(`${file}: ${lines} lines, limit ${FILE_LIMIT} — ${GROW}`);
    } else if (lines > recorded) {
      failures.push(`${file}: ${lines} lines, baseline ${recorded} — ${GROW}`);
    } else if (lines < recorded) {
      failures.push(
        `${file}: ${lines} lines, baseline ${recorded} — ${SHRINK}`,
      );
    }
  }
  for (const file of Object.keys(baseline.files)) {
    if (measured.files[file] === undefined)
      failures.push(
        `${file}: not found, baseline ${baseline.files[file]} — ${GONE}`,
      );
  }
  for (const [file, fns] of Object.entries(baseline.functions)) {
    for (const [name, recorded] of Object.entries(fns)) {
      const lines = measured.functions[file]?.[name];
      const where = `${file} ${name}()`;
      if (lines === undefined)
        failures.push(`${where}: ${FN_GONE}, baseline ${recorded}`);
      else if (lines > recorded)
        failures.push(
          `${where}: ${lines} lines, baseline ${recorded} — ${GROW}`,
        );
      else if (lines < recorded)
        failures.push(
          `${where}: ${lines} lines, baseline ${recorded} — ${SHRINK}`,
        );
    }
  }
  return failures;
}

/** Lowers or drops entries; never adds or raises one. */
function lowered(baseline: Baseline, measured: Baseline): Baseline {
  const files: Record<string, number> = {};
  for (const [file, recorded] of Object.entries(baseline.files)) {
    const lines = measured.files[file];
    if (lines !== undefined) files[file] = Math.min(recorded, lines);
  }
  const functions: Record<string, Record<string, number>> = {};
  for (const [file, fns] of Object.entries(baseline.functions)) {
    for (const [name, recorded] of Object.entries(fns)) {
      const lines = measured.functions[file]?.[name];
      if (lines === undefined) continue;
      (functions[file] ??= {})[name] = Math.min(recorded, lines);
    }
  }
  return { files, functions };
}

/** Adds new parts of a split at their size; never one over FILE_LIMIT. */
function recorded(baseline: Baseline, measured: Baseline, files: string[]) {
  const problems: string[] = [];
  const next = { ...baseline.files };
  for (const file of files) {
    const lines = measured.files[file];
    if (lines === undefined) problems.push(`${file}: not a measured src/ file`);
    else if (baseline.files[file] !== undefined)
      problems.push(`${file}: already recorded at ${baseline.files[file]}`);
    else if (lines > FILE_LIMIT)
      problems.push(`${file}: ${lines} lines, limit ${FILE_LIMIT} — ${GROW}`);
    else next[file] = lines;
  }
  return { baseline: { ...baseline, files: next }, problems };
}

const measured = measure();
const mode = process.argv[2];
if (mode === "--record") {
  const result = recorded(readBaseline(), measured, process.argv.slice(3));
  for (const line of result.problems) console.log(line);
  if (result.problems.length) process.exit(1);
  writeBaseline(result.baseline);
  console.log(`Recorded ${process.argv.length - 3} file(s) at their size.`);
} else if (mode === "--update") {
  writeBaseline(lowered(readBaseline(), measured));
  console.log(`Lowered ${BASELINE_PATH} to today's counts.`);
  const left = check(readBaseline(), measured);
  for (const line of left) console.log(line);
  if (left.length) process.exit(1);
} else {
  const failures = check(readBaseline(), measured);
  for (const line of failures) console.log(line);
  if (failures.length) {
    console.log(
      `\n${failures.length} size failure(s); see docs/RULES.md § Refactoring.`,
    );
    process.exit(1);
  }
  console.log("Size baseline: no file or recorded function grew.");
}
