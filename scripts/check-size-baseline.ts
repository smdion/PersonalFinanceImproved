/**
 * Size ratchet over src/ (CI blocks on it). size-baseline.json records every
 * file over FILE_LIMIT lines and every function over FUNCTION_LIMIT lines at
 * its length; a recorded entry never grows and is lowered when it shrinks.
 * An unrecorded file over FILE_LIMIT fails. New long functions are caught by
 * ESLint's max-lines-per-function. `--update` lowers entries, never raises.
 * `--move <old> <new>…` keeps a moved file's entries under its new path.
 * `--raise-renamed <file>…` records the given files' grown entries at their
 * size (rename-trpc-path.ts only: a proven path rename's re-wrap).
 * `--record <part>…` records each part of a split at its size, so a part
 * can't regrow to the limit; a part over the limit is refused. With
 * `--from <old>`, the parts' long functions carry the old file's entries, a
 * part of a recorded file may be over the limit, and the parts (with what
 * is left of the old file) together never exceed its entry and the import
 * lines the split adds (owner Q13). A body moved
 * whole into a part's function (the router now only calls it) hands that
 * function the router arrow's entry, plus its signature lines (owner Q14),
 * and the total may also hold the import, signature, brace and call lines
 * and what the parts held before (bodyCarry). A stage cut from a function
 * into a part (owner v0.10.3 Q1, the function now calls it and reads back
 * what it returns) carries that function's entry, and the total may also
 * hold the stage's signature, return and brace and the call. A UI cut
 * (owner v0.10.4 Q3: an IIFE's body into a function, a JSX run into a
 * component) carries the same way, with its function's lines around what
 * it took. Each new function a cut makes may also bring the lines
 * check-commit proves around it (splitReading): the blank line before it, a
 * component's props type, and a doc comment of RULES' three lines, as may a
 * new part's header. A part the per-commit ratchet (check-ratchets) would
 * refuse is refused here too: one over the limit, or carrying a function
 * entry, whose lines didn't mostly leave `--from`; and, when the parts over
 * the limit and what is left exceed the old entry, a rise that isn't
 * exactly the import lines (a plain split) or that holds a doc comment (a
 * cut), since the ratchet holds a Mechanical: rise to those.
 */
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import ts from "typescript";

import { attributeMoves, groupsOf, parseDiff } from "./ratchets/moves";
import { importLines } from "./ratchets/raise";

const FILE_LIMIT = 400;
const FUNCTION_LIMIT = 150;
/** RULES' comment limit: lines of text in one doc comment. */
const MAX_DOC_LINES = 3;
const BASELINE_PATH = "size-baseline.json";
const SRC_DIR = "src";
// Generated from the PostgreSQL schema by scripts/gen-sqlite-schema.ts.
const GENERATED = [
  /^src\/lib\/db\/sqlite\//,
  /^src\/lib\/db\/schema-sqlite\.ts$/,
];

export type Baseline = {
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
 * with its length and where it starts. Same-named ones are numbered in
 * source order.
 */
export function functionEntries(
  file: string,
  text: string,
): Map<string, { lines: number; line: number; character: number }> {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
  const entries = new Map<
    string,
    { lines: number; line: number; character: number }
  >();
  const visit = (node: ts.Node, segments: string[]) => {
    const segment = segmentOf(node);
    const here = segment ? [...segments, segment] : segments;
    if (isFunctionNode(node) && node.body) {
      const at = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      const end = sf.getLineAndCharacterOfPosition(node.getEnd()).line;
      const lines = end - at.line + 1;
      if (lines > FUNCTION_LIMIT) {
        const base = here.join(".") || "anonymous";
        let key = base;
        for (let n = 2; entries.has(key); n++) key = `${base} #${n}`;
        entries.set(key, { lines, line: at.line, character: at.character });
      }
    }
    ts.forEachChild(node, (child) => visit(child, here));
  };
  visit(sf, []);
  return entries;
}

function functionLengths(file: string, text: string): Map<string, number> {
  return new Map(
    [...functionEntries(file, text)].map(([key, { lines }]) => [key, lines]),
  );
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

export function check(baseline: Baseline, measured: Baseline): string[] {
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
export function lowered(baseline: Baseline, measured: Baseline): Baseline {
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

/**
 * A path rename's raises (AR9, rename-trpc-path.ts): each recorded entry of
 * `files` that grew is set to its size, and a file of `files` over the limit
 * is recorded. Nothing else changes; check-ratchets excuses these rises only
 * in a commit whose `Rename-path:` check-commit proves.
 */
export function raisedFor(
  baseline: Baseline,
  measured: Baseline,
  files: string[],
): { baseline: Baseline; raised: string[] } {
  const out: Baseline = {
    files: { ...baseline.files },
    functions: Object.fromEntries(
      Object.entries(baseline.functions).map(([f, fns]) => [f, { ...fns }]),
    ),
  };
  const raised: string[] = [];
  for (const file of files) {
    const lines = measured.files[file];
    if (lines === undefined) continue;
    const recorded = out.files[file];
    if (
      (recorded !== undefined && lines > recorded) ||
      (recorded === undefined && lines > FILE_LIMIT)
    ) {
      out.files[file] = lines;
      raised.push(`${file} ${recorded ?? 0} → ${lines}`);
    }
    for (const [name, was] of Object.entries(out.functions[file] ?? {})) {
      const now = measured.functions[file]?.[name];
      if (now !== undefined && now > was) {
        out.functions[file]![name] = now;
        raised.push(`${file} ${name}() ${was} → ${now}`);
      }
    }
  }
  return { baseline: out, raised };
}

/** Moves each old path's entries to its new path; never changes a count. */
export function moved(baseline: Baseline, measured: Baseline, paths: string[]) {
  const problems: string[] = [];
  const files = { ...baseline.files };
  const functions = { ...baseline.functions };
  if (paths.length === 0 || paths.length % 2 !== 0)
    problems.push("--move takes <old> <new> pairs");
  for (let i = 0; i + 1 < paths.length; i += 2) {
    const [from, to] = [paths[i]!, paths[i + 1]!];
    if (measured.files[from] !== undefined)
      problems.push(`${from}: still exists; move the file first`);
    else if (measured.files[to] === undefined)
      problems.push(`${to}: not a measured src/ file`);
    else if (files[to] !== undefined || functions[to] !== undefined)
      problems.push(`${to}: already recorded`);
    else {
      if (files[from] !== undefined) files[to] = files[from];
      if (functions[from] !== undefined) functions[to] = functions[from];
      delete files[from];
      delete functions[from];
    }
  }
  return { baseline: { files, functions }, problems };
}

/** A key without its first segment: a router const a split renames. */
const tail = (key: string) => key.slice(key.indexOf(".") + 1);

/**
 * What `--record --from` carries for a procedure body moved whole into a
 * service function (owner Q14): each new function's name → the router
 * entry it came from (`computeX` → `xRouter.summary.query()`), the lines
 * its signature and closing brace may add over the router's arrow (whose
 * head and `})` are read as one line each), and the lines the parts and
 * what is left may total over the old entry: the import lines they add,
 * each moved body's signature, brace and one-line call, and the lines the
 * parts already held. `stages` names each stage cut into a part → the entry
 * of the function it was cut from, which all its stages share (check-ratchets
 * holds each to its moved lines, commit by commit).
 */
export type BodyCarry = {
  renames: Record<string, string>;
  wrapper: Record<string, number>;
  total: number;
  stages?: Record<string, string>;
};

/**
 * The old file's entry a part's function carries: same key, else a moved
 * body's rename (its nested keys too), else a stage's function's (shared by
 * its stages; the ones inside a stage keep theirs), else same tail.
 */
function carriedEntry(
  key: string,
  old: Record<string, number>,
  used: Set<string>,
  renames: Record<string, string> = {},
  stages: Record<string, string> = {},
): string | undefined {
  if (old[key] !== undefined && !used.has(key)) return key;
  const dot = key.indexOf(".");
  const cutFrom = stages[dot < 0 ? key : key.slice(0, dot)];
  if (cutFrom !== undefined) {
    const was = cutFrom + (dot < 0 ? "" : key.slice(dot));
    if (old[was] === undefined) return undefined;
    return dot < 0 || !used.has(was) ? was : undefined;
  }
  const renamed = renames[dot < 0 ? key : key.slice(0, dot)];
  if (renamed !== undefined) {
    const was = renamed + (dot < 0 ? "" : key.slice(dot));
    return old[was] !== undefined && !used.has(was) ? was : undefined;
  }
  if (!key.includes(".")) return undefined;
  const matches = Object.keys(old).filter(
    (k) => k.includes(".") && tail(k) === tail(key) && !used.has(k),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Adds new parts of a split at their size. Without `from`, never one over
 * FILE_LIMIT. With `from`, each part's long functions carry `from`'s entries,
 * and a part of a recorded file may be over FILE_LIMIT while the parts plus
 * what is left of `from` stay within its entry.
 */
export function recorded(
  baseline: Baseline,
  measured: Baseline,
  parts: string[],
  from?: string,
  carry?: BodyCarry,
  split?: SplitReading,
) {
  const problems: string[] = [];
  const files = { ...baseline.files };
  const functions = { ...baseline.functions };
  const oldEntry = from === undefined ? undefined : baseline.files[from];
  const oldFns = from === undefined ? {} : (baseline.functions[from] ?? {});
  if (from !== undefined && oldEntry === undefined && !baseline.functions[from])
    problems.push(`${from}: no entry to split from`);
  const used = new Set<string>();
  for (const file of parts) {
    const lines = measured.files[file];
    if (lines === undefined) {
      problems.push(`${file}: not a measured src/ file`);
      continue;
    }
    if (file === from) {
      problems.push(`${file}: the file split from is not a part`);
      continue;
    }
    if (baseline.files[file] !== undefined) {
      problems.push(`${file}: already recorded at ${baseline.files[file]}`);
      continue;
    }
    if (lines > FILE_LIMIT && oldEntry === undefined)
      problems.push(`${file}: ${lines} lines, limit ${FILE_LIMIT} — ${GROW}`);
    else if (
      split &&
      !split.joined(file) &&
      (lines > FILE_LIMIT || Object.keys(measured.functions[file] ?? {}).length)
    )
      problems.push(
        `${file}: ${lines} lines, not joined to ${from} (under half its lines left it), so the per-commit ratchet reads it as a new file — ${GROW}`,
      );
    else files[file] = lines;
    if (from === undefined) continue;
    for (const [key, fnLines] of Object.entries(
      measured.functions[file] ?? {},
    )) {
      if (baseline.functions[file]?.[key] !== undefined) continue;
      const carried = carriedEntry(
        key,
        oldFns,
        used,
        carry?.renames,
        carry?.stages,
      );
      const where = `${file} ${key}()`;
      if (carried === undefined)
        problems.push(
          `${where}: ${fnLines} lines, no entry in ${from} — ${GROW}`,
        );
      else if (fnLines > oldFns[carried]! + (carry?.wrapper[key] ?? 0))
        problems.push(
          `${where}: ${fnLines} lines, ${from} ${carried}() ${oldFns[carried]}${carry?.wrapper[key] ? ` and +${carry.wrapper[key]} for its signature` : ""} — ${GROW}`,
        );
      else {
        if (carry?.stages?.[key] === undefined) used.add(carried);
        functions[file] = { ...functions[file], [key]: fnLines };
      }
    }
  }
  if (from !== undefined && oldEntry !== undefined) {
    const total =
      parts.reduce((sum, f) => sum + (measured.files[f] ?? 0), 0) +
      (measured.files[from] ?? 0);
    const layout = (split?.layout ?? 0) + (split?.docs ?? 0);
    const allowed = oldEntry + (carry?.total ?? 0) + layout;
    if (total > allowed)
      problems.push(
        `${from}: the parts and what is left total ${total} lines, entry ${oldEntry}${allowance(carry)}${layout ? ` and +${layout} for the blank lines, props types and doc comments its new functions bring` : ""} — ${GROW}`,
      );
    if (split)
      problems.push(
        ...ratchetRise(measured, parts, from, oldEntry, carry, split),
      );
  }
  return { baseline: { files, functions }, problems };
}

/** What a split's total may hold over the old entry, as the refusal names it. */
function allowance(carry: BodyCarry | undefined): string {
  if (!carry?.total) return "";
  const moved =
    Object.keys(carry.renames).length + Object.keys(carry.stages ?? {}).length;
  return ` and +${carry.total} for ${moved > 0 ? "the moved bodies" : "the import lines it adds"}`;
}

/**
 * What a split adds that check-commit proves and the per-commit ratchet
 * reads (owner v0.10.4 Q3): `layout`, the blank line before each function a
 * cut makes and a component's props type (the ratchet skips blank lines
 * and cuts the props type out with the component); `docs`, the doc comment
 * above each such function and a new part's header, each of RULES' three
 * lines at most (the ratchet counts these); `imports`, the import lines
 * each file gains; `joined`, whether the ratchet joins a part to `from`.
 */
export type SplitReading = {
  layout: number;
  docs: number;
  imports: Record<string, number>;
  joined: (file: string) => boolean;
};

/**
 * The per-commit ratchet's reading of the split (scripts/ratchets/counts.ts
 * and check-ratchets): it sums only the parts over FILE_LIMIT with what is
 * left of `from`. A sum over the old entry is a rise, which a Mechanical:
 * commit holds to exactly the import lines of those files (a plain split),
 * or, with a cut, to no line but imports once the cuts are taken out (so no
 * doc comment).
 */
function ratchetRise(
  measured: Baseline,
  parts: string[],
  from: string,
  oldEntry: number,
  carry: BodyCarry | undefined,
  split: SplitReading,
): string[] {
  const counted = parts.filter((f) => (measured.files[f] ?? 0) > FILE_LIMIT);
  const sum = [from, ...counted].reduce(
    (n, f) => n + (measured.files[f] ?? 0),
    0,
  );
  const rise = sum - oldEntry;
  if (rise <= 0) return [];
  const cuts =
    Object.keys(carry?.renames ?? {}).length +
    Object.keys(carry?.stages ?? {}).length;
  const files = [from, ...counted].join(", ");
  if (cuts > 0)
    return split.docs > 0
      ? [
          `${files}: ${sum} lines, entry ${oldEntry}: the per-commit ratchet reads +${rise}, and a cut's rise may hold no doc comment (${split.docs} lines) — fit them within the entry, or ${GROW}`,
        ]
      : [];
  const imports = [from, ...counted].reduce(
    (n, f) => n + (split.imports[f] ?? 0),
    0,
  );
  return rise === imports
    ? []
    : [
        `${files}: ${sum} lines, entry ${oldEntry}: the per-commit ratchet reads +${rise}, and a split's rise is exactly the ${imports} import lines these files add — ${GROW}`,
      ];
}

/** Lines of the comments directly above `node` (a new function or part;
 *  `gap` blank lines may stand between, as below a part's header):
 *  all of them when they hold at most MAX_DOC_LINES lines of text, else
 *  none. */
function docLines(node: ts.Node, sf: ts.SourceFile, gap = 0): number {
  const ranges = ts.getLeadingCommentRanges(sf.text, node.getFullStart());
  if (!ranges || ranges.length === 0) return 0;
  const line = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line;
  const first = line(ranges[0]!.pos);
  const last = line(ranges[ranges.length - 1]!.end);
  if (line(node.getStart(sf)) - last > 1 + gap) return 0;
  const text = ranges
    .map((r) => sf.text.slice(r.pos, r.end))
    .join("\n")
    .split("\n")
    .filter(
      (l) =>
        l
          .replace(/^\s*(\/\/+|\/\*\*?|\*(?!\/))?/, "")
          .replace(/\*\/\s*$/, "")
          .trim() !== "",
    ).length;
  return text <= MAX_DOC_LINES ? last - first + 1 : 0;
}

/**
 * The SplitReading of a split from `from` into `parts`, for the functions
 * `carry` names (the bodies, stages and UI cuts it found); `joined` as the
 * ratchet joins files over the change.
 */
export function splitReading(
  from: string,
  parts: string[],
  now: (file: string) => string | undefined,
  before: (file: string) => string | undefined,
  carry: BodyCarry,
  joined: (file: string) => boolean,
): SplitReading {
  const reading: SplitReading = { layout: 0, docs: 0, imports: {}, joined };
  const made = new Set([
    ...Object.keys(carry.renames),
    ...Object.keys(carry.stages ?? {}),
  ]);
  for (const file of [from, ...parts]) {
    const [was, is] = [
      importLines(file, before(file)),
      importLines(file, now(file)),
    ];
    reading.imports[file] =
      is.statements + is.types - was.statements - was.types;
  }
  for (const part of parts) {
    const text = now(part);
    if (text === undefined) continue;
    const sf = ts.createSourceFile(part, text, ts.ScriptTarget.Latest, true);
    const line = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line;
    const statements = [...sf.statements];
    // A new part's header: the comment above its first statement after a
    // directive ("use client"), unless that is a new function's own.
    if (before(part) === undefined) {
      const first = statements.find(
        (s) =>
          !(ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression)),
      );
      if (
        first &&
        !(ts.isFunctionDeclaration(first) && made.has(first.name?.text ?? ""))
      )
        reading.docs += docLines(first, sf, 1);
    }
    statements.forEach((statement, i) => {
      if (!ts.isFunctionDeclaration(statement) || !statement.name) return;
      if (!made.has(statement.name.text)) return;
      const prev = statements[i - 1];
      const type = statement.parameters[0]?.type;
      const props =
        prev &&
        (ts.isTypeAliasDeclaration(prev) || ts.isInterfaceDeclaration(prev)) &&
        type &&
        ts.isTypeReferenceNode(type) &&
        ts.isIdentifier(type.typeName) &&
        type.typeName.text === prev.name.text
          ? prev
          : undefined;
      const top = props ?? statement;
      if (props)
        reading.layout += line(props.getEnd()) - line(props.getStart(sf)) + 1;
      reading.docs += docLines(top, sf);
      if (props) reading.docs += docLines(statement, sf);
      const docTop = ts.getLeadingCommentRanges(sf.text, top.getFullStart());
      const start = docTop?.length
        ? line(docTop[0]!.pos)
        : line(top.getStart(sf));
      if (start > 0 && /^\s*$/.test(text.split("\n")[start - 1] ?? "x"))
        reading.layout += 1;
    });
  }
  return reading;
}

/** A function node's key, as functionEntries names it (unnumbered). */
function keyOf(node: ts.Node): string {
  const segments: string[] = [];
  for (let n: ts.Node | undefined = node; n; n = n.parent) {
    const segment = segmentOf(n);
    if (segment) segments.unshift(segment);
  }
  return segments.join(".") || "anonymous";
}

/** The callee of a pass-through: `(…) => fn(…)` or `(…) => { return fn(…); }`. */
function passedTo(node: ts.Node): string | undefined {
  if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node))
    return undefined;
  let call: ts.Node | undefined = node.body;
  if (ts.isBlock(node.body))
    call =
      node.body.statements.length === 1 &&
      ts.isReturnStatement(node.body.statements[0]!)
        ? node.body.statements[0].expression
        : undefined;
  return call && ts.isCallExpression(call) && ts.isIdentifier(call.expression)
    ? call.expression.text
    : undefined;
}

/**
 * The callee of a stage's call: `fn(…);` or `const|let { … } = fn(…);`,
 * awaited or not, as a statement of a function's body.
 */
function stageCalled(statement: ts.Statement): string | undefined {
  let call: ts.Expression | undefined;
  if (ts.isExpressionStatement(statement)) call = statement.expression;
  else if (
    ts.isVariableStatement(statement) &&
    statement.declarationList.declarations.length === 1 &&
    ts.isObjectBindingPattern(statement.declarationList.declarations[0]!.name)
  )
    call = statement.declarationList.declarations[0]!.initializer;
  if (call && ts.isAwaitExpression(call)) call = call.expression;
  return call && ts.isCallExpression(call) && ts.isIdentifier(call.expression)
    ? call.expression.text
    : undefined;
}

/**
 * The BodyCarry for a split from `from` into `parts`: a part's top-level
 * function that `from` now only calls through (the router's pass-through)
 * takes the entry of that arrow's key. `now` and `before` read a file in
 * the tree and at HEAD.
 */
export function bodyCarry(
  from: string,
  parts: string[],
  now: (file: string) => string | undefined,
  before: (file: string) => string | undefined,
): BodyCarry {
  const carry: BodyCarry = { renames: {}, wrapper: {}, total: 0 };
  const parse = (file: string, text: string) =>
    ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const fromText = now(from);
  if (fromText === undefined) return carry;
  const passes = new Map<string, string>();
  const visit = (node: ts.Node) => {
    const callee = passedTo(node);
    if (callee !== undefined) passes.set(callee, keyOf(node));
    ts.forEachChild(node, visit);
  };
  const fromSource = parse(from, fromText);
  visit(fromSource);
  // Each stage's call, and the function it sits in.
  const stageCalls = new Map<string, { key: string; lines: number }>();
  const fromLine = (pos: number) =>
    fromSource.getLineAndCharacterOfPosition(pos).line;
  const visitStages = (node: ts.Node) => {
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node)) &&
      node.body &&
      ts.isBlock(node.body)
    )
      for (const statement of node.body.statements) {
        const callee = stageCalled(statement);
        if (callee !== undefined && !stageCalls.has(callee))
          stageCalls.set(callee, {
            key: keyOf(node),
            lines:
              fromLine(statement.getEnd()) -
              fromLine(statement.getStart(fromSource)) +
              1,
          });
      }
    ts.forEachChild(node, visitStages);
  };
  visitStages(fromSource);
  // Each UI cut's call (owner v0.10.4 Q3): `<Part … />`, or `fn(…)` inside
  // JSX, and the function it sits in.
  const uiCalls = new Map<
    string,
    { key: string; lines: number; kind: "jsx" | "iife" }
  >();
  const inJsx = (node: ts.Node) => {
    for (let up = node.parent; up && !ts.isSourceFile(up); up = up.parent)
      if (ts.isJsxExpression(up)) return true;
    return false;
  };
  const visitUi = (node: ts.Node, fn: ts.Node | undefined) => {
    const here = isFunctionNode(node) ? node : fn;
    let called: { name: string; kind: "jsx" | "iife" } | undefined;
    if (ts.isJsxSelfClosingElement(node) && ts.isIdentifier(node.tagName))
      called = { name: node.tagName.text, kind: "jsx" };
    else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      inJsx(node)
    )
      called = { name: node.expression.text, kind: "iife" };
    if (called && here && !uiCalls.has(called.name))
      uiCalls.set(called.name, {
        key: keyOf(here),
        kind: called.kind,
        lines:
          fromLine(node.getEnd()) - fromLine(node.getStart(fromSource)) + 1,
      });
    ts.forEachChild(node, (child) => visitUi(child, here));
  };
  visitUi(fromSource, undefined);
  for (const part of parts) {
    const text = now(part);
    if (text === undefined) continue;
    const sf = parse(part, text);
    const line = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line;
    for (const statement of sf.statements) {
      if (!ts.isFunctionDeclaration(statement) || !statement.body) continue;
      const name = statement.name?.text;
      const key = name === undefined ? undefined : passes.get(name);
      const stage = name === undefined ? undefined : stageCalls.get(name);
      if (name !== undefined && key === undefined && stage !== undefined) {
        // Its lines around the statements it took: the signature, the
        // blank line and return after them, and its `}`.
        const body = [...statement.body.statements];
        if (body.length > 0 && ts.isReturnStatement(body[body.length - 1]!))
          body.pop();
        const inner =
          body.length === 0
            ? 0
            : line(body[body.length - 1]!.getEnd()) -
              line(statement.body.getStart(sf));
        const all = line(statement.getEnd()) - line(statement.getStart(sf)) + 1;
        carry.stages = { ...carry.stages, [name]: stage.key };
        carry.total += all - inner + stage.lines;
        continue;
      }
      const ui = name === undefined ? undefined : uiCalls.get(name);
      const took = ui && uiCutLines(statement, statement.body, ui.kind, line);
      if (name !== undefined && key === undefined && ui && took) {
        // Its lines around what it took: the signature and `}`, and a
        // component's `return (`, fragment and `);`.
        const all = line(statement.getEnd()) - line(statement.getStart(sf)) + 1;
        carry.stages = { ...carry.stages, [name]: ui.key };
        carry.total += all - took + ui.lines;
        continue;
      }
      if (name === undefined || key === undefined) continue;
      const signature =
        line(statement.body.getStart(sf)) - line(statement.getStart(sf)) + 1;
      carry.renames[name] = key;
      carry.wrapper[name] = Math.max(0, signature + 1 - 2);
      carry.total += signature + 1 + 1;
    }
  }
  // Owner Q13: the files a split joins may also hold the import lines it
  // adds, net across them (a plain split never less than its entry), and
  // what a part already held.
  let imports = 0;
  for (const file of [from, ...parts]) {
    const [was, is] = [
      importLines(file, before(file)),
      importLines(file, now(file)),
    ];
    imports += is.statements + is.types - was.statements - was.types;
    const held = before(file);
    if (file !== from && held !== undefined) carry.total += countLines(held);
  }
  const moves =
    Object.keys(carry.renames).length + Object.keys(carry.stages ?? {}).length;
  carry.total += moves > 0 ? imports : Math.max(0, imports);
  return carry;
}

/**
 * The lines a UI cut's function took (owner v0.10.4 Q3): an IIFE's body
 * between its braces, or the JSX a component returns (a fragment's
 * children); undefined when a component returns anything else.
 */
function uiCutLines(
  fn: ts.FunctionDeclaration,
  body: ts.Block,
  kind: "jsx" | "iife",
  line: (pos: number) => number,
): number | undefined {
  const sf = fn.getSourceFile();
  if (kind === "iife")
    return Math.max(0, line(body.getEnd()) - line(body.getStart(sf)) - 1);
  const [only, ...rest] = body.statements;
  if (!only || rest.length > 0 || !ts.isReturnStatement(only)) return undefined;
  let e = only.expression;
  while (e && ts.isParenthesizedExpression(e)) e = e.expression;
  if (!e) return undefined;
  let run: readonly ts.Node[] = [e];
  if (ts.isJsxFragment(e))
    run = e.children.filter(
      (c) => !ts.isJsxText(c) || !c.containsOnlyTriviaWhiteSpaces,
    );
  else if (!ts.isJsxElement(e) && !ts.isJsxSelfClosingElement(e))
    return undefined;
  if (run.length === 0) return undefined;
  return line(run[run.length - 1]!.getEnd()) - line(run[0]!.getStart(sf)) + 1;
}

function gitShowHead(file: string): string | undefined {
  try {
    return execFileSync("git", ["show", `HEAD:${file}`], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return undefined;
  }
}

/**
 * Whether the per-commit ratchet joins a file to `from`: its added lines
 * mostly left `from` in the change since HEAD (ratchets/moves.ts), new
 * parts not yet added to git read as all added.
 */
function joinedTo(
  from: string,
  parts: string[],
  now: (file: string) => string | undefined,
): (file: string) => boolean {
  const diff = execFileSync("git", ["diff", "--no-renames", "-U0", "HEAD"], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 1024,
  });
  const diffs = parseDiff(diff);
  for (const part of parts) {
    const text = now(part);
    if (
      diffs.has(part) ||
      text === undefined ||
      gitShowHead(part) !== undefined
    )
      continue;
    diffs.set(part, { added: text.split("\n"), deleted: [] });
  }
  const group = groupsOf(attributeMoves(diffs));
  return (file) => group(file) === group(from);
}

function main(argv: string[]): number {
  const measured = measure();
  const mode = argv[0];
  const args = argv.slice(1);
  if (mode === "--record" || mode === "--move") {
    const fromIdx = args.indexOf("--from");
    const from = fromIdx >= 0 ? args[fromIdx + 1] : undefined;
    const parts = args.filter(
      (_, i) => fromIdx < 0 || (i !== fromIdx && i !== fromIdx + 1),
    );
    const now = (f: string) =>
      fs.existsSync(f) ? fs.readFileSync(f, "utf8") : undefined;
    const carry =
      from === undefined ? undefined : bodyCarry(from, parts, now, gitShowHead);
    const result =
      mode === "--move"
        ? moved(readBaseline(), measured, args)
        : recorded(
            readBaseline(),
            measured,
            parts,
            from,
            carry,
            from === undefined || carry === undefined
              ? undefined
              : splitReading(
                  from,
                  parts,
                  now,
                  gitShowHead,
                  carry,
                  joinedTo(from, parts, now),
                ),
          );
    for (const line of result.problems) console.log(line);
    if (result.problems.length) return 1;
    writeBaseline(result.baseline);
    console.log(
      mode === "--move"
        ? `Moved ${args.length / 2} file(s)' entries.`
        : `Recorded ${parts.length} file(s) at their size.`,
    );
    if (from !== undefined)
      console.log(
        "Then `pnpm check:file-size --update` drops the old entries.",
      );
    return 0;
  }
  if (mode === "--raise-renamed") {
    const { baseline, raised } = raisedFor(readBaseline(), measured, args);
    if (raised.length > 0) writeBaseline(baseline);
    for (const line of raised) console.log(`raised ${line}`);
    return 0;
  }
  if (mode === "--update") {
    writeBaseline(lowered(readBaseline(), measured));
    console.log(`Lowered ${BASELINE_PATH} to today's counts.`);
    const left = check(readBaseline(), measured);
    for (const line of left) console.log(line);
    return left.length ? 1 : 0;
  }
  const failures = check(readBaseline(), measured);
  for (const line of failures) console.log(line);
  if (failures.length) {
    console.log(
      `\n${failures.length} size failure(s); see docs/RULES.md § Refactoring.`,
    );
    return 1;
  }
  console.log("Size baseline: no file or recorded function grew.");
  return 0;
}

if (
  process.argv[1] &&
  // Real paths: a worktree may hold the script as a symlink.
  fs.realpathSync(path.resolve(process.argv[1])) ===
    fs.realpathSync(fileURLToPath(import.meta.url))
)
  process.exitCode = main(process.argv.slice(2));
