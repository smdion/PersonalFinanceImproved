/**
 * Commit rules (CONTRIBUTING.md § Commit rules). The commit-msg hook and CI pass
 * `--strict`, so a breach blocks; without it (`--history`) the script only reports.
 *
 *   tsx scripts/check-commit.ts --message-file .git/COMMIT_EDITMSG  (commit-msg hook: the staged change)
 *   tsx scripts/check-commit.ts --range origin/main..HEAD           (CI: every commit in a pull request)
 *   tsx scripts/check-commit.ts --history 50                        (counts over the last 50 commits)
 *
 * Checks: a `type:` subject prefix, a body that says why, at most 400 changed
 * `src/` lines and at most 8 `src/` files when the engine or tax code is
 * touched (a `Mechanical:` trailer exempts a pure move, rename or split: git
 * sees a rename or code moved between files, and every other changed line is
 * an import, a path rewrite, or code moved in whole top-level statements kept
 * in order, a function body moved whole into a new top-level function and
 * called from where it was, router procedures moved whole into a new
 * part mounted where they were, or a UI cut: an IIFE's body into a named
 * function, a JSX run into a component; with `Rename: old → new, …`, every
 * changed code line is its old line with those names renamed, owner Q2:
 * notARename), and the
 * second-fix rule: a fix to a function that already had a fix in the last 30
 * days names the missing concept in a `Concept:` trailer; a third goes to the
 * advisor first, recorded by an `Advisor: PASS (round <n>)` trailer. A
 * revert says why in its own words: git's "This reverts commit …" line
 * alone isn't a reason.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  isShapeFile,
  storedAndResponseKeys,
} from "./gen-abbreviation-carve-outs";

export const SUBJECT_PREFIX =
  /^(feat|fix|refactor|perf|test|docs|build|ci|chore|style|revert|release)(\([^)]+\))?!?: \S/;
export const MAX_SRC_LINES = 400;
export const MAX_ENGINE_FILES = 8;
export const FIX_WINDOW_DAYS = 30;
const DAY_SECONDS = 86_400;

/** Generated from other files, so not counted in a commit's size. */
const GENERATED = [
  /^src\/lib\/db\/sqlite\//,
  /^src\/lib\/db\/schema-sqlite\.ts$/,
];
/** Engine and tax code, where a commit may touch at most 8 `src/` files. */
const ENGINE_OR_TAX = [
  /^src\/lib\/pure\/(engine|tax|paycheck)\//,
  /^src\/lib\/pure\/contributions\/irs-limits\.ts$/,
  /^src\/lib\/tax-data\//,
  /^src\/lib\/config\/[^/]*tax[^/]*\.ts$/,
];

export type ParsedMessage = {
  subject: string;
  body: string;
  trailers: Record<string, string>;
};

export type FileChange = { file: string; added: number; deleted: number };

/** A function a diff touched, keyed `file::name`. */
export type Spot = string;

export type CommitFacts = {
  message: ParsedMessage;
  files: FileChange[];
  spots: Spot[];
  /** For each spot, how many earlier fix commits touched it in the window. */
  priorFixes: Map<Spot, number>;
  /** Why a `Mechanical:` commit isn't a move (undefined: it is, or no trailer). */
  notMechanical?: string;
};

export type Warning = { rule: string; text: string };

const TRAILER = /^([A-Za-z][\w-]*): (.+)$/;

/** A message's lines, without git's comment lines. */
const messageLines = (raw: string) =>
  raw
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .map((line) => line.trimEnd());

/** `Key: value` on one line, or undefined. */
export function readTrailer(
  line: string,
): { key: string; value: string } | undefined {
  const [, key, value] = TRAILER.exec(line) ?? [];
  if (!key || !value || key === "http" || key === "https") return undefined;
  return { key, value };
}

/** Every value of a trailer that may repeat (parseMessage keeps the last). */
export function trailerValues(raw: string, key: string): string[] {
  return messageLines(raw)
    .slice(1)
    .flatMap((line) => {
      const trailer = readTrailer(line);
      return trailer?.key === key ? [trailer.value] : [];
    });
}

export function parseMessage(raw: string): ParsedMessage {
  const lines = messageLines(raw);
  const subject = (lines[0] ?? "").trim();
  const trailers: Record<string, string> = {};
  const bodyLines: string[] = [];
  for (const line of lines.slice(1)) {
    const trailer = readTrailer(line);
    if (trailer) trailers[trailer.key] = trailer.value;
    else bodyLines.push(line);
  }
  return { subject, body: bodyLines.join("\n").trim(), trailers };
}

/** git revert's own body line: it says what was reverted, not why. */
const REVERT_BOILERPLATE = /^This reverts commit [0-9a-f]{7,40}\b.*$/;

/** A `revert:` subject, or git's default `Revert "…"` one. */
export function isRevertSubject(subject: string): boolean {
  return (
    /^revert(\([^)]+\))?!?: /.test(subject) || subject.startsWith('Revert "')
  );
}

/** A revert's reason: its body without git's boilerplate line, or a `Why:`/`Reason:` line. */
export function revertReason(message: ParsedMessage): string {
  const own = message.body
    .split("\n")
    .filter((line) => !REVERT_BOILERPLATE.test(line.trim()))
    .join("\n")
    .trim();
  return own || message.trailers.Why || message.trailers.Reason || "";
}

export function isFixSubject(subject: string): boolean {
  return /^fix(\([^)]+\))?!?:/.test(subject);
}

/**
 * A prefixed subject is a fix only with `fix:`. Most of the history has no
 * prefix, so there a subject that says "fix" counts.
 */
export function looksLikeFix(subject: string): boolean {
  if (SUBJECT_PREFIX.test(subject)) return isFixSubject(subject);
  return /\bfix(es|ed)?\b/i.test(subject);
}

export function parseNumstat(text: string): FileChange[] {
  const changes: FileChange[] = [];
  for (const line of text.split("\n")) {
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const [added, deleted, file] = parts as [string, string, string];
    changes.push({
      file,
      added: added === "-" ? 0 : Number(added),
      deleted: deleted === "-" ? 0 : Number(deleted),
    });
  }
  return changes;
}

const isCounted = (file: string) =>
  file.startsWith("src/") && !GENERATED.some((pattern) => pattern.test(file));

export function srcLinesChanged(files: FileChange[]): number {
  return files
    .filter((change) => isCounted(change.file))
    .reduce((sum, change) => sum + change.added + change.deleted, 0);
}

export function touchesEngineOrTax(files: FileChange[]): boolean {
  return files.some((change) =>
    ENGINE_OR_TAX.some((pattern) => pattern.test(change.file)),
  );
}

export function srcFileCount(files: FileChange[]): number {
  return files.filter((change) => isCounted(change.file)).length;
}

const NAME_IN_HUNK =
  /(?:function\*?\s+|class\s+|(?:const|let|var)\s+)([A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*)\s*(?:=\s*(?:async\s*)?\(|\()/;

/** The function each hunk sits in, from git's `@@ … @@ <context>` header. */
export function spotsFromDiff(diff: string): Spot[] {
  const spots = new Set<Spot>();
  let file = "";
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      file = line.startsWith("+++ b/") ? line.slice(6) : "";
      continue;
    }
    if (!file.startsWith("src/") || !line.startsWith("@@")) continue;
    const context = line.replace(/^@@[^@]*@@\s?/, "");
    const match = NAME_IN_HUNK.exec(context);
    const name = match?.[1] ?? match?.[2];
    if (name && !["if", "for", "while", "switch", "return"].includes(name)) {
      spots.add(`${file}::${name}`);
    }
  }
  return [...spots];
}

/** Outside code (docs, data), a line a move may change freely: an import,
 *  an export-from, a name in an import list, or punctuation. */
const IMPORT_LINE =
  /^\s*(import\b|export\b.*\bfrom\b|\}\s*from\b|(type\s+)?[\w$]+(\s+as\s+[\w$]+)?,?\s*$|[{}();,\s]*$)/;
/** A path-like token: anything with a slash in it. */
const PATH_TOKEN = /[\w@.~$[\]()-]*\/[\w@.~$[\]()/-]*/g;
/**
 * Files a move rewrites as its own record, each guarded by its own check
 * (check:ratchets, check:layers and its trailers, check:calculation-register,
 * check:engine-hash, docs:verify-api for the router catalog), so the move
 * check doesn't read them line by line.
 */
const MOVE_BOOKKEEPING =
  /^(size-baseline\.json|eslint-suppressions(-typed)?\.json|\.dependency-cruiser-known-violations\.json|scripts\/calculation-register-baseline\.json|docs\/API_ROUTERS\.md|src\/lib\/generated\/.*)$/;
/** A comment line: a line comment, or a line of a block comment. */
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*\/|\*(\s|$))/;
/** The calculation register, whose code-reference cells docs:verify checks. */
const REGISTER_DOC = "docs/CALCULATIONS.md";
/** A table cell naming code: a backticked `file.ts` or `file.ts:name`. */
const CODE_REF_CELL = /`[^`|]*\.tsx?(:[^`|]*)?`/;
/** A changed line and its file (and, for a comment, where it stands). */
type Line = {
  file: string;
  line: string;
  at?: number;
  side?: "old" | "new";
  /** A comment of a file the change creates or deletes. */
  whole?: boolean;
};
/** A generated count in the docs (docs:verify checks it). */
const AUTO_GEN_LINE = /<!-- AUTO-GEN:\w+ -->/;

/** Old and new path of each rename in a `--numstat` name (`a/{b => c}/d`). */
export function renamePair(name: string): [string, string] | undefined {
  const brace = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(name);
  if (brace) {
    const [, pre, from, to, post] = brace;
    const clean = (p: string) => p.replace(/\/\//g, "/");
    return [clean(`${pre}${from}${post}`), clean(`${pre}${to}${post}`)];
  }
  const plain = /^(.*) => (.*)$/.exec(name);
  return plain ? [plain[1]!, plain[2]!] : undefined;
}

/** The bare names of renamed files, as they appear in prose and docs. */
function renamedNames(numstat: FileChange[]): RegExp | undefined {
  const names = new Set<string>();
  for (const change of numstat) {
    const pair = renamePair(change.file);
    if (!pair) continue;
    for (const p of pair) {
      const base = p.split("/").pop()!;
      if (base) names.add(base);
    }
  }
  if (names.size === 0) return undefined;
  const escaped = [...names].map((n) =>
    n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  return new RegExp(`(?<![\\w-])(${escaped.join("|")})(?![\\w-])`, "g");
}

/** A line with its paths, spacing, table padding and trailing comma gone. */
const withoutPaths = (line: string, names?: RegExp) =>
  (names ? line.replace(names, "<path>") : line)
    .replace(PATH_TOKEN, "<path>")
    .replace(/\s+/g, " ")
    .replace(/ ?\| ?/g, "|")
    .replace(/-{3,}/g, "---")
    .trim()
    .replace(/,$/, "")
    // A generated cell lists its entries sorted by path; a move reorders them.
    .split("|")
    .map((cell) => cell.split("; ").sort().join("; "))
    .join("|");

/** A source file's name, its path and line too (`stages/rmd.ts:60`). */
const FILE_NAME = /[\w@.~$/-]*\.[cm]?[jt]sx?\b(:\d+)?/g;
/** A comment line with the source files it names read as paths: a move
 *  rewrites the name of the file its code moved to. */
const commentPaths = (line: string) =>
  COMMENT_LINE.test(line) ? line.replace(FILE_NAME, "<path>") : line;

/** RULES' limit on a comment: at most three lines of current reason. */
const MAX_COMMENT_LINES = 3;
/** A block comment's delimiter alone on its line (`/**`, `*\/`, `*`). */
const DELIMITER_ONLY = /^\s*(\/\*\*?|\*\/|\*)\s*$/;

/**
 * The comment blocks of a side (runs of comment lines) that hold one of
 * the lines at `at`, each as how many of those it holds (delimiter-only
 * lines aside): a reworded line of a longer block counts, the rest of the
 * block, kept as it was, doesn't.
 */
function blocksHolding(side: DiffSide, at: Set<number>): number[] {
  const out: number[] = [];
  for (let l = 0; l < side.lines.length;) {
    if (!COMMENT_LINE.test(side.lines[l]!)) {
      l += 1;
      continue;
    }
    let hit = false;
    let changed = 0;
    for (; l < side.lines.length && COMMENT_LINE.test(side.lines[l]!); l++)
      if (at.has(l)) {
        hit = true;
        if (!DELIMITER_ONLY.test(side.lines[l]!)) changed += 1;
      }
    if (hit) out.push(changed);
  }
  return out;
}

/**
 * Why the comment lines a move leaves unexplained aren't rewordings (owner
 * v0.10.4 Q3), or undefined: no comment block takes more than
 * MAX_COMMENT_LINES new or reworded lines on the new side, and no more such
 * blocks than blocks they change on the old side plus the functions the
 * move made (each may bring its doc comment).
 */
function rewordedComments(
  unexplained: Line[],
  sidesOf: Map<string, { old: DiffSide; new: DiffSide }>,
  newFunctions: number,
): string | undefined {
  const blocks = { old: [] as number[], new: [] as number[] };
  for (const [file, sides] of sidesOf)
    for (const side of ["old", "new"] as const) {
      const at = new Set(
        unexplained.flatMap((l) =>
          l.file === file &&
          l.side === side &&
          l.at !== undefined &&
          COMMENT_LINE.test(l.line)
            ? [l.at]
            : [],
        ),
      );
      if (at.size > 0) blocks[side].push(...blocksHolding(sides[side], at));
    }
  const long = blocks.new.filter((n) => n > MAX_COMMENT_LINES);
  if (long.length > 0)
    return `a reworded or new comment of ${Math.max(...long)} lines (at most ${MAX_COMMENT_LINES}; a longer rewording goes in its own commit)`;
  const extra = blocks.new.length - blocks.old.length - newFunctions;
  if (extra > 0)
    return `${extra} comment block(s) added that reword none the move took away`;
  return undefined;
}

/**
 * The comment blocks of `root` inside `[start, end]` (a block comment, or
 * adjacent line comments each on its own line), each as its text, spacing
 * collapsed, and its text lines (delimiters aside), in order.
 */
function commentBlocksIn(
  root: ts.Node,
  source: ts.SourceFile,
  start: number,
  end: number,
): { text: string; lines: number }[] {
  const full = source.getFullText();
  const found = new Map<number, ts.CommentRange>();
  const add = (ranges: ts.CommentRange[] | undefined) => {
    for (const r of ranges ?? [])
      if (r.pos >= start && r.end <= end) found.set(r.pos, r);
  };
  const visit = (n: ts.Node) => {
    const children = n.getChildren(source);
    if (children.length > 0) children.forEach(visit);
    else {
      add(ts.getLeadingCommentRanges(full, n.getFullStart()));
      add(ts.getTrailingCommentRanges(full, n.getEnd()));
    }
  };
  visit(root);
  const lineOf = (pos: number) =>
    source.getLineAndCharacterOfPosition(pos).line;
  const ownLine = (pos: number) =>
    BLANK_LINE.test(full.slice(full.lastIndexOf("\n", pos - 1) + 1, pos));
  const blocks: {
    text: string[];
    lines: number;
    last: number;
    joins: boolean;
  }[] = [];
  for (const r of [...found.values()].sort((a, b) => a.pos - b.pos)) {
    const raw = full.slice(r.pos, r.end);
    const single = r.kind === ts.SyntaxKind.SingleLineCommentTrivia;
    const prev = blocks[blocks.length - 1];
    if (
      single &&
      prev?.joins &&
      ownLine(r.pos) &&
      prev.last === lineOf(r.pos) - 1
    ) {
      prev.text.push(raw);
      prev.lines += 1;
      prev.last = lineOf(r.end);
      continue;
    }
    blocks.push({
      text: [raw],
      lines: single
        ? 1
        : raw.split("\n").filter(
            (l) =>
              l
                .replace(/^\s*(\/\*\*?|\*(?!\/))?/, "")
                .replace(/\*\/\s*$/, "")
                .trim() !== "",
          ).length,
      last: lineOf(r.end),
      joins: single && ownLine(r.pos),
    });
  }
  return blocks.map((b) => ({
    text: b.text.join(" ").replace(/\s+/g, " "),
    lines: b.lines,
  }));
}

/**
 * Why the comments inside moved code aren't its old ones (owner v0.10.4
 * Q3), or undefined: each block as it was, or rewording one that went, in
 * RULES' three lines at most; none added (one may go with no rewording).
 */
function movedCommentsProblem(
  was: { text: string; lines: number }[],
  now: { text: string; lines: number }[],
): string | undefined {
  const kept = inOrder(
    was.map((b) => b.text),
    now.map((b) => b.text),
  );
  const keptNow = new Set(kept.map(([, j]) => j));
  const reworded = now.filter((_, j) => !keptNow.has(j));
  if (reworded.length > was.length - kept.length)
    return "a comment is added in the moved code";
  const long = reworded.find((b) => b.lines > MAX_COMMENT_LINES);
  if (long)
    return `a moved comment is reworded to ${long.lines} lines (at most ${MAX_COMMENT_LINES})`;
  return undefined;
}

/** The comments of the code between two nodes' ends, as commentBlocksIn reads them. */
const commentsOfRun = (nodes: readonly ts.Node[], source: ts.SourceFile) =>
  nodes.length === 0
    ? []
    : commentBlocksIn(
        nodes[0]!.parent,
        source,
        nodes[0]!.getStart(source),
        nodes[nodes.length - 1]!.getEnd(),
      );

/** The comments inside a function body's braces. */
const commentsOfBody = (body: ts.Block, source: ts.SourceFile) =>
  commentBlocksIn(body, source, body.getStart(source), body.getEnd());

/** Enough context that each hunk is its whole file. */
const FULL_CONTEXT = "-U1000000";
/** Source code: read by statement, and its moved lines kept in order. */
const CODE_FILE = /\.[cm]?[jt]sx?$/;
/** A blank line, which a move may add or drop anywhere. */
const BLANK_LINE = /^\s*$/;

/** One side of a file in a full-context diff: its lines, and which changed. */
type DiffSide = {
  lines: string[];
  /** Each changed line's index in `lines`, with its change group. */
  changed: { at: number; group: number }[];
};
/** A file in a diff; `-U0` hunks give only part of each side. */
type FileDiff = {
  file: string;
  wholeFile: boolean;
  old: DiffSide;
  new: DiffSide;
};

/** Each file of `diff`, both sides rebuilt from its hunks. */
function readDiff(diff: string): FileDiff[] {
  const files: FileDiff[] = [];
  let current: FileDiff | undefined;
  let header = false;
  let group = 0;
  let inChange = false;
  const change = (side: DiffSide, text: string) => {
    if (!inChange) group += 1;
    inChange = true;
    side.changed.push({ at: side.lines.length, group });
    side.lines.push(text);
  };
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      current = {
        file: "",
        wholeFile: false,
        old: { lines: [], changed: [] },
        new: { lines: [], changed: [] },
      };
      files.push(current);
      header = true;
    } else if (!current) {
      continue;
    } else if (header && /^(new|deleted) file mode /.test(line)) {
      current.wholeFile = true;
    } else if (line.startsWith("@@")) {
      header = false;
      inChange = false;
    } else if (header) {
      // A deleted file is named by its old path.
      if (line.startsWith("--- a/")) current.file = line.slice(6);
      else if (line.startsWith("+++ b/")) current.file = line.slice(6);
    } else if (line.startsWith("-")) change(current.old, line.slice(1));
    else if (line.startsWith("+")) change(current.new, line.slice(1));
    else if (line.startsWith(" ")) {
      inChange = false;
      current.old.lines.push(line.slice(1));
      current.new.lines.push(line.slice(1));
    }
  }
  return files;
}

/**
 * A function body moved whole into a top-level function (a tRPC procedure's
 * inline body to a service): the source is an arrow or function expression
 * with a block body, the destination a new top-level function declaration
 * whose body is the same statements in the same order.
 */
type MovedBodyFunction = ts.ArrowFunction | ts.FunctionExpression;
/** A cut in one side: its positions, and the text left in their place. */
type Span = { start: number; end: number; text: string };

function parseSide(file: string, side: DiffSide): ts.SourceFile {
  return ts.createSourceFile(
    file,
    side.lines.join("\n"),
    ts.ScriptTarget.Latest,
    true,
  );
}

/**
 * A JSX text as React renders it: each line trimmed where it breaks, blank
 * lines dropped, the rest joined by one space. A re-indent or prettier's
 * re-fill keeps it; a space lost or gained beside an expression doesn't.
 */
function jsxTextValue(text: string): string {
  const lines = text.split(/\r\n|\n|\r/);
  return lines
    .map((line, i) => {
      let l = i > 0 ? line.replace(/^[ \t]+/, "") : line;
      if (i < lines.length - 1) l = l.replace(/[ \t]+$/, "");
      return l;
    })
    .filter((l) => l !== "")
    .join(" ");
}

const STRING_TOKEN = new Set([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
]);
const CLOSER = new Set([")", "]", "}", ">"]);

/**
 * A node's tokens, without comments and layout: the re-indent and prettier's
 * re-wrap change neither, and a trailing comma is layout. Strings lose their
 * paths, as moved lines do.
 */
function tokensOf(
  node: ts.Node,
  source: ts.SourceFile,
  names?: RegExp,
): string[] {
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (
      n.kind >= ts.SyntaxKind.FirstJSDocNode &&
      n.kind <= ts.SyntaxKind.LastJSDocNode
    )
      return;
    const children = n.getChildren(source);
    if (children.length > 0) {
      children.forEach(visit);
      return;
    }
    if (n.kind === ts.SyntaxKind.EndOfFileToken) return;
    let text = n.getText(source);
    if (STRING_TOKEN.has(n.kind))
      text = (names ? text.replace(names, "<path>") : text).replace(
        PATH_TOKEN,
        "<path>",
      );
    else if (n.kind === ts.SyntaxKind.JsxText) text = jsxTextValue(text);
    if (text !== "") out.push(text);
  };
  visit(node);
  return out.filter((t, i) => !(t === "," && CLOSER.has(out[i + 1] ?? "")));
}

const isAsync = (node: ts.Node) =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node) ?? []).some(
    (m) => m.kind === ts.SyntaxKind.AsyncKeyword,
  );

/** The names a parameter list binds, or undefined if one has a default. */
function boundNames(
  params: readonly ts.ParameterDeclaration[],
): string[] | undefined {
  const out: string[] = [];
  const bind = (name: ts.BindingName): boolean => {
    if (ts.isIdentifier(name)) {
      out.push(name.text);
      return true;
    }
    return name.elements.every(
      (el) => ts.isOmittedExpression(el) || (!el.initializer && bind(el.name)),
    );
  };
  for (const p of params) {
    if (p.initializer || !bind(p.name)) return undefined;
  }
  return out;
}

/** Each line of `[start, end]` that holds code is a changed line. */
function allChanged(
  side: DiffSide,
  source: ts.SourceFile,
  start: number,
  end: number,
): boolean {
  const changed = new Set(side.changed.map((c) => c.at));
  const first = source.getLineAndCharacterOfPosition(start).line;
  const last = source.getLineAndCharacterOfPosition(end).line;
  for (let l = first; l <= last; l++) {
    const line = side.lines[l]!;
    if (BLANK_LINE.test(line) || COMMENT_LINE.test(line)) continue;
    if (!changed.has(l)) return false;
  }
  return true;
}

/** A moved body may not read its own `this` or `arguments`. */
const OWN_BINDING = new Set(["this", "arguments", "super"]);

/**
 * The body a source expression gives up: an arrow or function expression
 * with a block body, not inside another function (its body may then read
 * only module-level names), every code line of it changed.
 */
function movableBody(
  node: ts.Node,
  side: DiffSide,
  source: ts.SourceFile,
): node is MovedBodyFunction & { body: ts.Block } {
  if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) return false;
  if (node.asteriskToken || !node.body || !ts.isBlock(node.body)) return false;
  if (node.body.statements.length === 0) return false;
  for (let up = node.parent; up && !ts.isSourceFile(up); up = up.parent)
    if (ts.isFunctionLike(up) || ts.isClassStaticBlockDeclaration(up))
      return false;
  return allChanged(side, source, node.getStart(source), node.getEnd());
}

/**
 * The replacement for a moved body: an arrow or function expression with the
 * source's own parameters (no defaults), whose only statement is `fn(…)`
 * passing each bound name once, matched to `fn`'s parameters by name.
 */
function passesThrough(
  r: ts.Node,
  from: MovedBodyFunction,
  to: ts.FunctionDeclaration,
  oldSource: ts.SourceFile,
  newSource: ts.SourceFile,
): boolean {
  if (!ts.isArrowFunction(r) && !ts.isFunctionExpression(r)) return false;
  if (ts.isFunctionExpression(r) && (r.name || r.asteriskToken)) return false;
  if (r.typeParameters || r.type) return false;
  const modifiers = ts.getModifiers(r) ?? [];
  if (modifiers.some((m) => m.kind !== ts.SyntaxKind.AsyncKeyword))
    return false;
  if (isAsync(r) && !isAsync(from)) return false;
  if (r.parameters.length !== from.parameters.length) return false;
  const same = r.parameters.every(
    (p, i) =>
      tokensOf(p, newSource).join(" ") ===
      tokensOf(from.parameters[i]!, oldSource).join(" "),
  );
  const bound = boundNames(r.parameters);
  if (!same || !bound) return false;
  let call: ts.Expression | undefined;
  if (!ts.isBlock(r.body)) call = r.body;
  else if (r.body.statements.length === 1) {
    const only = r.body.statements[0]!;
    if (ts.isReturnStatement(only)) call = only.expression;
  }
  if (!call || !ts.isCallExpression(call)) return false;
  if (call.typeArguments || call.questionDotToken) return false;
  if (!ts.isIdentifier(call.expression)) return false;
  if (call.expression.text !== to.name?.text) return false;
  const args = call.arguments.map((a) => (ts.isIdentifier(a) ? a.text : ""));
  if (args.some((a) => a === "")) return false;
  if (new Set(args).size !== args.length) return false;
  if ([...args].sort().join() !== [...bound].sort().join()) return false;
  if (to.parameters.length !== args.length) return false;
  return to.parameters.every(
    (p, i) =>
      ts.isIdentifier(p.name) &&
      p.name.text === args[i] &&
      !p.initializer &&
      !p.dotDotDotToken,
  );
}

/** A line of closing brackets and commas only. */
const CLOSERS_LINE = /^[\s)\]},;]*$/;

/** A side with each span cut to its text (a whole-line span with no text goes). */
function collapse(
  side: DiffSide,
  source: ts.SourceFile,
  spans: Span[],
): DiffSide {
  const groupAt = new Map(side.changed.map((c) => [c.at, c.group]));
  const next: DiffSide = { lines: [], changed: [] };
  const push = (line: string, group: number | undefined) => {
    if (group !== undefined)
      next.changed.push({ at: next.lines.length, group });
    next.lines.push(line);
  };
  const at = (pos: number) => source.getLineAndCharacterOfPosition(pos);
  let i = 0;
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    const s = at(span.start);
    const e = at(span.end);
    for (; i < s.line; i++) push(side.lines[i]!, groupAt.get(i));
    let group: number | undefined;
    for (let l = s.line; l <= e.line && group === undefined; l++)
      group = groupAt.get(l);
    let merged =
      side.lines[s.line]!.slice(0, s.character) +
      span.text +
      side.lines[e.line]!.slice(e.character);
    i = e.line + 1;
    if (span.text === "") {
      if (!BLANK_LINE.test(merged)) push(merged, group);
      continue;
    }
    // Prettier may close the call on later lines (`fn(x) =>\n  call(),\n),`).
    while (
      i < side.lines.length &&
      groupAt.has(i) &&
      CLOSERS_LINE.test(side.lines[i]!)
    )
      merged += side.lines[i++]!.trim();
    // The marker is a word, so it needs no escaping.
    const trailing = new RegExp(`${span.text}\\s*,(?=\\s*[)\\]}])`);
    push(merged.replace(trailing, span.text), group);
  }
  for (; i < side.lines.length; i++) push(side.lines[i]!, groupAt.get(i));
  return next;
}

/**
 * A body cutMovedBodies found: the files it left and joined, where its
 * source expression started in the old file, the new function's name, and
 * the lines of each side's wrapper (the head or signature through `{`, and
 * `}` to the end) and body, all lines and code lines (not blank).
 */
export type BodyMove = {
  from: string;
  to: string;
  start: { line: number; character: number };
  name: string;
  wrapper: { old: number; new: number };
  body: { old: number; new: number };
  bodyCode: { old: number; new: number };
};

/** A function's wrapper lines and its body's lines, all and not blank. */
function wrapperAndBody(
  node: ts.FunctionLikeDeclaration & { body: ts.Block },
  source: ts.SourceFile,
  lines: string[],
): { wrapper: number; body: number; bodyCode: number } {
  const line = (pos: number) => source.getLineAndCharacterOfPosition(pos).line;
  const start = line(node.getStart(source));
  const open = line(node.body.getStart(source));
  const close = line(node.body.getEnd());
  const end = line(node.getEnd());
  if (open === close) return { wrapper: end - start + 1, body: 0, bodyCode: 0 };
  const inner = lines.slice(open + 1, close);
  return {
    wrapper: open - start + 1 + (end - close + 1),
    body: inner.length,
    bodyCode: inner.filter((l) => !BLANK_LINE.test(l)).length,
  };
}

/**
 * Finds each body moved whole into a new top-level function, and cuts it out
 * of both sides: the source expression and its replacement become one marker,
 * and the destination function goes (its doc comment stays a comment). The
 * lines left around the marker are then read as any other changed line.
 * Returns how many statements moved between files, and each move.
 */
function cutMovedBodies(
  files: FileDiff[],
  names?: RegExp,
): { movedAcross: number; moves: BodyMove[] } {
  const code = files
    .map((entry) => ({
      entry,
      oldSource: parseSide(entry.file, entry.old),
      newSource: parseSide(entry.file, entry.new),
    }))
    .filter(
      ({ entry }) =>
        CODE_FILE.test(entry.file) && !MOVE_BOOKKEEPING.test(entry.file),
    );
  const bodyKey = (body: ts.Block, source: ts.SourceFile) =>
    body.statements.map((s) => tokensOf(s, source, names).join(" "));
  const sources: {
    f: number;
    node: MovedBodyFunction & { body: ts.Block };
    key: string[];
  }[] = [];
  const dests: { f: number; node: ts.FunctionDeclaration; key: string[] }[] =
    [];
  code.forEach(({ entry, oldSource, newSource }, f) => {
    const visit = (node: ts.Node) => {
      if (movableBody(node, entry.old, oldSource)) {
        const key = bodyKey(node.body, oldSource);
        if (!key.some((s) => s.split(" ").some((t) => OWN_BINDING.has(t))))
          sources.push({ f, node, key });
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(oldSource);
    for (const statement of newSource.statements) {
      if (!ts.isFunctionDeclaration(statement)) continue;
      if (!statement.name || !statement.body || statement.asteriskToken)
        continue;
      const modifiers = ts.getModifiers(statement) ?? [];
      const allowed = [ts.SyntaxKind.ExportKeyword, ts.SyntaxKind.AsyncKeyword];
      if (modifiers.some((m) => !allowed.includes(m.kind))) continue;
      const start = statement.getStart(newSource);
      const end = statement.getEnd();
      const { character } = newSource.getLineAndCharacterOfPosition(start);
      const endLine = newSource.getLineAndCharacterOfPosition(end).line;
      const after = entry.new.lines[endLine]!.slice(
        newSource.getLineAndCharacterOfPosition(end).character,
      );
      if (character !== 0 || !BLANK_LINE.test(after)) continue;
      if (!allChanged(entry.new, newSource, start, end)) continue;
      dests.push({
        f,
        node: statement,
        key: bodyKey(statement.body, newSource),
      });
    }
  });

  const spans = code.map(() => ({ old: [] as Span[], new: [] as Span[] }));
  const lineOf = (source: ts.SourceFile, pos: number) =>
    source.getLineAndCharacterOfPosition(pos).line;
  const free = (taken: Span[], source: ts.SourceFile, s: number, e: number) =>
    taken.every(
      (t) =>
        lineOf(source, e) < lineOf(source, t.start) ||
        lineOf(source, s) > lineOf(source, t.end),
    );
  const groupOf = (side: DiffSide, line: number) =>
    side.changed.find((c) => c.at === line)?.group;
  const claimed = new Set<number>();
  const moves: BodyMove[] = [];
  let movedAcross = 0;
  let marker = 0;
  for (const dest of dests) {
    const to = code[dest.f]!;
    for (const [s, from] of sources.entries()) {
      if (claimed.has(s)) continue;
      if (isAsync(from.node) !== isAsync(dest.node)) continue;
      if (from.key.join("\n") !== dest.key.join("\n")) continue;
      const at = code[from.f]!;
      if (
        movedCommentsProblem(
          commentsOfBody(from.node.body, at.oldSource),
          commentsOfBody(dest.node.body!, to.newSource),
        ) !== undefined
      )
        continue;
      const group = groupOf(
        at.entry.old,
        lineOf(at.oldSource, from.node.getStart(at.oldSource)),
      );
      let replacement: ts.Node | undefined;
      const look = (node: ts.Node) => {
        if (replacement) return;
        const start = node.getStart(at.newSource);
        if (
          groupOf(at.entry.new, lineOf(at.newSource, start)) === group &&
          passesThrough(
            node,
            from.node,
            dest.node,
            at.oldSource,
            at.newSource,
          ) &&
          allChanged(at.entry.new, at.newSource, start, node.getEnd())
        ) {
          replacement = node;
          return;
        }
        ts.forEachChild(node, look);
      };
      if (group !== undefined) look(at.newSource);
      if (!replacement) continue;
      const r = {
        start: replacement.getStart(at.newSource),
        end: replacement.getEnd(),
      };
      const d = {
        start: dest.node.getStart(to.newSource),
        end: dest.node.getEnd(),
      };
      const e = {
        start: from.node.getStart(at.oldSource),
        end: from.node.getEnd(),
      };
      const newTaken = spans[from.f]!.new;
      const destTaken = spans[dest.f]!.new;
      if (
        !free(spans[from.f]!.old, at.oldSource, e.start, e.end) ||
        !free(newTaken, at.newSource, r.start, r.end) ||
        !free(destTaken, to.newSource, d.start, d.end) ||
        (from.f === dest.f &&
          !(
            lineOf(to.newSource, r.end) < lineOf(to.newSource, d.start) ||
            lineOf(to.newSource, r.start) > lineOf(to.newSource, d.end)
          ))
      )
        continue;
      marker += 1;
      const text = `__movedBody${marker}__`;
      spans[from.f]!.old.push({ ...e, text });
      newTaken.push({ ...r, text });
      destTaken.push({ ...d, text: "" });
      claimed.add(s);
      if (from.f !== dest.f) movedAcross += dest.key.length;
      const was = wrapperAndBody(from.node, at.oldSource, at.entry.old.lines);
      const now = wrapperAndBody(
        dest.node as ts.FunctionDeclaration & { body: ts.Block },
        to.newSource,
        to.entry.new.lines,
      );
      moves.push({
        from: at.entry.file,
        to: to.entry.file,
        start: at.oldSource.getLineAndCharacterOfPosition(e.start),
        name: dest.node.name!.text,
        wrapper: { old: was.wrapper, new: now.wrapper },
        body: { old: was.body, new: now.body },
        bodyCode: { old: was.bodyCode, new: now.bodyCode },
      });
      break;
    }
  }
  code.forEach(({ entry, oldSource, newSource }, f) => {
    if (spans[f]!.old.length > 0)
      entry.old = collapse(entry.old, oldSource, spans[f]!.old);
    if (spans[f]!.new.length > 0)
      entry.new = collapse(entry.new, newSource, spans[f]!.new);
  });
  return { movedAcross, moves };
}

/**
 * Procedures a router split moved (plan 42): whole properties of one router
 * object literal, in order, into a new router file's literal, mounted back.
 * `kind` is "router" for `export const x = createTRPCRouter({…})` (mounted
 * as `key: x`), "object" for `export const x = {…}` (mounted as `...x`).
 */
export type RouterMove = {
  from: string;
  to: string;
  name: string;
  kind: "router" | "object";
  properties: number;
  /** Code lines (not blank) of the moved properties, at each side. */
  code: { old: number; new: number };
};

const ROUTER_CALL = "createTRPCRouter";

/** A router object literal: `createTRPCRouter({…})`'s argument, or a top-level `const x = {…}`. */
function isRouterLiteral(node: ts.Node): node is ts.ObjectLiteralExpression {
  if (!ts.isObjectLiteralExpression(node)) return false;
  const up = node.parent;
  if (
    ts.isCallExpression(up) &&
    ts.isIdentifier(up.expression) &&
    up.expression.text === ROUTER_CALL &&
    !up.typeArguments &&
    up.arguments.length === 1 &&
    up.arguments[0] === node
  )
    return true;
  return (
    ts.isVariableDeclaration(up) &&
    up.initializer === node &&
    ts.isVariableDeclarationList(up.parent) &&
    ts.isVariableStatement(up.parent.parent) &&
    ts.isSourceFile(up.parent.parent.parent)
  );
}

/** The names on the way down to a literal (`fooRouter.portfolioSnapshots`). */
function literalPath(node: ts.Node): string {
  const names: string[] = [];
  for (let up = node.parent; up && !ts.isSourceFile(up); up = up.parent)
    if (
      (ts.isPropertyAssignment(up) || ts.isVariableDeclaration(up)) &&
      ts.isIdentifier(up.name)
    )
      names.unshift(up.name.text);
  return names.join(".");
}

/**
 * A new router part: a top-level `export const x = createTRPCRouter({…});`
 * or `export const x = {…};` (no type, no `as`/`satisfies`), alone on its
 * lines, holding only `key: value` properties.
 */
function newRouterPart(statement: ts.Statement):
  | {
      name: string;
      kind: RouterMove["kind"];
      literal: ts.ObjectLiteralExpression;
    }
  | undefined {
  if (!ts.isVariableStatement(statement)) return undefined;
  const modifiers = ts.getModifiers(statement) ?? [];
  if (
    modifiers.length !== 1 ||
    modifiers[0]!.kind !== ts.SyntaxKind.ExportKeyword
  )
    return undefined;
  const list = statement.declarationList;
  if (!(list.flags & ts.NodeFlags.Const) || list.declarations.length !== 1)
    return undefined;
  const decl = list.declarations[0]!;
  if (!ts.isIdentifier(decl.name) || decl.type || decl.exclamationToken)
    return undefined;
  const init = decl.initializer;
  const literal = init && literalOf(init);
  if (!init || !literal || !isRouterLiteral(literal)) return undefined;
  if (literal.properties.length === 0) return undefined;
  if (!literal.properties.every(ts.isPropertyAssignment)) return undefined;
  return {
    name: decl.name.text,
    kind: ts.isCallExpression(init) ? "router" : "object",
    literal,
  };
}

/** `{…}` itself, or the `{…}` of `createTRPCRouter({…})`. */
function literalOf(
  init: ts.Expression,
): ts.ObjectLiteralExpression | undefined {
  if (ts.isObjectLiteralExpression(init)) return init;
  if (ts.isCallExpression(init) && init.arguments.length === 1) {
    const arg = init.arguments[0]!;
    if (ts.isObjectLiteralExpression(arg)) return arg;
  }
  return undefined;
}

/** A node's span with the comma after it, when one follows on its line. */
function withComma(node: ts.Node, source: ts.SourceFile): Span {
  const start = node.getStart(source);
  let end = node.getEnd();
  const after = /^[ \t]*,/.exec(source.text.slice(end));
  if (after) end += after[0].length;
  return { start, end, text: "" };
}

/** Code lines (not blank) from `start`'s line to `end`'s. */
function codeLinesIn(
  side: DiffSide,
  source: ts.SourceFile,
  start: number,
  end: number,
): number {
  const first = source.getLineAndCharacterOfPosition(start).line;
  const last = source.getLineAndCharacterOfPosition(end).line;
  return side.lines.slice(first, last + 1).filter((l) => !BLANK_LINE.test(l))
    .length;
}

/**
 * Finds each router split (plan 42) and cuts it out of both sides: the
 * moved properties leave the old literal, the new part's statement goes,
 * and so does its one mount in the old literal (`key: part` for a
 * `createTRPCRouter` part, `...part` for a procedures object). The part
 * holds only whole properties of one router literal, each wholly removed
 * there, in their old order, token for token; its file is another file;
 * the mount is a new property of the same literal (same names down to it)
 * in the file the properties left. What is left is read as before.
 */
function cutMovedProcedures(
  files: FileDiff[],
  names?: RegExp,
): { movedAcross: number; moves: RouterMove[] } {
  const code = files
    .map((entry) => ({
      entry,
      oldSource: parseSide(entry.file, entry.old),
      newSource: parseSide(entry.file, entry.new),
    }))
    .filter(
      ({ entry }) =>
        CODE_FILE.test(entry.file) && !MOVE_BOOKKEEPING.test(entry.file),
    );
  type Removed = { prop: ts.PropertyAssignment; key: string };
  const literals: {
    f: number;
    path: string;
    removed: (Removed | undefined)[];
  }[] = [];
  code.forEach(({ entry, oldSource }, f) => {
    const visit = (node: ts.Node) => {
      if (isRouterLiteral(node))
        literals.push({
          f,
          path: literalPath(node),
          removed: node.properties.map((prop) =>
            ts.isPropertyAssignment(prop) &&
            allChanged(
              entry.old,
              oldSource,
              prop.getStart(oldSource),
              prop.getEnd(),
            )
              ? { prop, key: tokensOf(prop, oldSource, names).join(" ") }
              : undefined,
          ),
        });
      ts.forEachChild(node, visit);
    };
    visit(oldSource);
  });

  const spans = code.map(() => ({ old: [] as Span[], new: [] as Span[] }));
  const lineOf = (source: ts.SourceFile, pos: number) =>
    source.getLineAndCharacterOfPosition(pos).line;
  const free = (taken: Span[], source: ts.SourceFile, span: Span) =>
    taken.every(
      (t) =>
        lineOf(source, span.end) < lineOf(source, t.start) ||
        lineOf(source, span.start) > lineOf(source, t.end),
    );
  const claimed = new Set<ts.Node>();
  const moves: RouterMove[] = [];
  let movedAcross = 0;
  code.forEach((to, d) => {
    for (const statement of to.newSource.statements) {
      const part = newRouterPart(statement);
      if (!part) continue;
      const start = statement.getStart(to.newSource);
      const end = statement.getEnd();
      const at = to.newSource.getLineAndCharacterOfPosition(start);
      const endAt = to.newSource.getLineAndCharacterOfPosition(end);
      if (at.character !== 0) continue;
      if (
        !BLANK_LINE.test(to.entry.new.lines[endAt.line]!.slice(endAt.character))
      )
        continue;
      if (!allChanged(to.entry.new, to.newSource, start, end)) continue;
      const keys = part.literal.properties.map((p) =>
        tokensOf(p, to.newSource, names).join(" "),
      );
      for (const literal of literals) {
        if (literal.f === d) continue;
        // The part's properties, in order, among the literal's removed ones.
        const picked: Removed[] = [];
        let i = 0;
        for (const key of keys) {
          while (
            i < literal.removed.length &&
            (literal.removed[i]?.key !== key ||
              claimed.has(literal.removed[i]!.prop))
          )
            i += 1;
          if (i === literal.removed.length) break;
          picked.push(literal.removed[i++]!);
        }
        if (picked.length !== keys.length) continue;
        // Its one mount, in the same literal where the properties left.
        const from = code[literal.f]!;
        let mount: ts.Node | undefined;
        const look = (node: ts.Node) => {
          if (mount) return;
          if (isRouterLiteral(node) && literalPath(node) === literal.path) {
            mount = node.properties.find(
              (p) =>
                !claimed.has(p) &&
                (part.kind === "router"
                  ? ts.isPropertyAssignment(p) &&
                    ts.isIdentifier(p.initializer) &&
                    p.initializer.text === part.name
                  : ts.isSpreadAssignment(p) &&
                    ts.isIdentifier(p.expression) &&
                    p.expression.text === part.name) &&
                allChanged(
                  from.entry.new,
                  from.newSource,
                  p.getStart(from.newSource),
                  p.getEnd(),
                ),
            );
            return;
          }
          ts.forEachChild(node, look);
        };
        look(from.newSource);
        if (!mount) continue;
        const oldSpans = picked.map((r) => withComma(r.prop, from.oldSource));
        const mountSpan = withComma(mount, from.newSource);
        const partSpan: Span = { start, end, text: "" };
        if (
          !oldSpans.every((s) =>
            free(spans[literal.f]!.old, from.oldSource, s),
          ) ||
          !free(spans[literal.f]!.new, from.newSource, mountSpan) ||
          !free(spans[d]!.new, to.newSource, partSpan)
        )
          continue;
        spans[literal.f]!.old.push(...oldSpans);
        spans[literal.f]!.new.push(mountSpan);
        spans[d]!.new.push(partSpan);
        for (const r of picked) claimed.add(r.prop);
        claimed.add(mount);
        movedAcross += picked.length;
        const sum = (counts: number[]) => counts.reduce((a, b) => a + b, 0);
        moves.push({
          from: from.entry.file,
          to: to.entry.file,
          name: part.name,
          kind: part.kind,
          properties: picked.length,
          code: {
            old: sum(
              picked.map((r) =>
                codeLinesIn(
                  from.entry.old,
                  from.oldSource,
                  r.prop.getStart(from.oldSource),
                  r.prop.getEnd(),
                ),
              ),
            ),
            new: sum(
              part.literal.properties.map((p) =>
                codeLinesIn(
                  to.entry.new,
                  to.newSource,
                  p.getStart(to.newSource),
                  p.getEnd(),
                ),
              ),
            ),
          },
        });
        break;
      }
    }
  });
  code.forEach(({ entry, oldSource, newSource }, f) => {
    if (spans[f]!.old.length > 0)
      entry.old = collapse(entry.old, oldSource, spans[f]!.old);
    if (spans[f]!.new.length > 0)
      entry.new = collapse(entry.new, newSource, spans[f]!.new);
  });
  return { movedAcross, moves };
}

/**
 * A stage cut from a long function (owner v0.10.3 Q1): contiguous top-level
 * statements of one function's body, moved in order into a new top-level
 * function. `start` is where the function they left starts in the old file;
 * `wrapper.new` the lines the stage adds around them (its signature through
 * `{`, the blank line and `return { … }` after them, its `}`), `wrapper.old`
 * the lines of the call left in their place.
 */
export type StageMove = BodyMove & { statements: number; returned: string[] };

/** A function node with a block body. */
type BlockFunction = ts.FunctionLikeDeclaration & { body: ts.Block };

/** A node that starts a new function scope (its `return` is its own). */
const opensScope = (node: ts.Node) =>
  ts.isFunctionDeclaration(node) ||
  ts.isFunctionExpression(node) ||
  ts.isArrowFunction(node) ||
  ts.isMethodDeclaration(node) ||
  ts.isConstructorDeclaration(node) ||
  ts.isGetAccessorDeclaration(node) ||
  ts.isSetAccessorDeclaration(node) ||
  ts.isClassStaticBlockDeclaration(node);

/** Every identifier a binding name binds (defaults allowed). */
function bindingIdentifiers(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((el) =>
    ts.isOmittedExpression(el) ? [] : bindingIdentifiers(el.name),
  );
}

/** The names a top-level statement declares, and whether they hoist. */
function declaredBy(statement: ts.Statement): {
  names: string[];
  hoists: boolean;
  mutable: boolean;
} {
  if (ts.isVariableStatement(statement)) {
    const flags = statement.declarationList.flags;
    const block = (flags & ts.NodeFlags.BlockScoped) !== 0;
    return {
      names: statement.declarationList.declarations.flatMap((d) =>
        bindingIdentifiers(d.name),
      ),
      hoists: !block,
      mutable: (flags & ts.NodeFlags.Const) === 0,
    };
  }
  if (
    (ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isEnumDeclaration(statement)) &&
    statement.name
  )
    return {
      names: [statement.name.text],
      hoists: ts.isFunctionDeclaration(statement),
      mutable: false,
    };
  return { names: [], hoists: false, mutable: false };
}

/** Whether an identifier reads or writes a binding (not a property, label or declared name). */
function isReference(id: ts.Identifier): boolean {
  const p = id.parent;
  if (ts.isPropertyAccessExpression(p) || ts.isQualifiedName(p))
    return ts.isPropertyAccessExpression(p) ? p.name !== id : p.right !== id;
  if (ts.isBindingElement(p)) return false;
  // An intrinsic tag (`<div>`) names no binding.
  if (
    (ts.isJsxOpeningElement(p) ||
      ts.isJsxSelfClosingElement(p) ||
      ts.isJsxClosingElement(p)) &&
    p.tagName === id &&
    /^[a-z]/.test(id.text)
  )
    return false;
  if (
    (ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p)) &&
    p.label === id
  )
    return false;
  if (
    (ts.isPropertyAssignment(p) ||
      ts.isPropertyDeclaration(p) ||
      ts.isPropertySignature(p) ||
      ts.isMethodDeclaration(p) ||
      ts.isMethodSignature(p) ||
      ts.isGetAccessorDeclaration(p) ||
      ts.isSetAccessorDeclaration(p) ||
      ts.isEnumMember(p) ||
      ts.isVariableDeclaration(p) ||
      ts.isParameter(p) ||
      ts.isFunctionDeclaration(p) ||
      ts.isFunctionExpression(p) ||
      ts.isClassDeclaration(p) ||
      ts.isClassExpression(p) ||
      ts.isInterfaceDeclaration(p) ||
      ts.isTypeAliasDeclaration(p) ||
      ts.isEnumDeclaration(p) ||
      ts.isTypeParameterDeclaration(p) ||
      ts.isNamedTupleMember(p) ||
      ts.isJsxAttribute(p)) &&
    p.name === id
  )
    return false;
  return true;
}

/** The identifiers an assignment target writes. */
function targetNames(node: ts.Node): string[] {
  if (ts.isIdentifier(node)) return [node.text];
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isTypeAssertionExpression(node)
  )
    return targetNames(node.expression);
  if (ts.isObjectLiteralExpression(node))
    return node.properties.flatMap((p) =>
      ts.isShorthandPropertyAssignment(p)
        ? [p.name.text]
        : ts.isPropertyAssignment(p)
          ? targetNames(p.initializer)
          : ts.isSpreadAssignment(p)
            ? targetNames(p.expression)
            : [],
    );
  if (ts.isArrayLiteralExpression(node))
    return node.elements.flatMap((e) =>
      ts.isSpreadElement(e) ? targetNames(e.expression) : targetNames(e),
    );
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.EqualsToken
  )
    return targetNames(node.left);
  return [];
}

const isAssignment = (kind: ts.SyntaxKind) =>
  kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;

/** The `var` names a function body (or a run of it) declares, nested functions aside. */
function varNames(nodes: readonly ts.Node[]): string[] {
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclarationList(node) &&
      !(node.flags & ts.NodeFlags.BlockScoped)
    )
      node.declarations.forEach((d) => out.push(...bindingIdentifiers(d.name)));
    if (!opensScope(node)) ts.forEachChild(node, visit);
  };
  nodes.forEach(visit);
  return out;
}

/** The names a block's statements declare for the whole block. */
function blockNames(statements: readonly ts.Statement[]): string[] {
  return statements.flatMap((s) => {
    const d = declaredBy(s);
    return d.hoists && !ts.isFunctionDeclaration(s) ? [] : d.names;
  });
}

/**
 * What a run of statements reads and writes from outside itself: the names
 * it reads and assigns that no scope inside it declares (its own top-level
 * declarations count as outside), the ones of those read inside a function
 * it creates, and whether it returns, yields, awaits or reads its own
 * `this`/`arguments`/`super` (or `new.target`) at its own level.
 */
function scopeFacts(nodes: readonly ts.Node[]) {
  const refs = new Set<string>();
  const assigned = new Set<string>();
  const inClosure = new Set<string>();
  let returns = false;
  let yields = false;
  let awaits = false;
  let own = false;
  const scopes: Set<string>[] = [];
  const free = (name: string) => !scopes.some((scope) => scope.has(name));
  const write = (target: ts.Node) =>
    targetNames(target)
      .filter(free)
      .forEach((n) => assigned.add(n));
  const within = (names: string[], go: () => void) => {
    scopes.push(new Set(names));
    go();
    scopes.pop();
  };
  const visit = (node: ts.Node, nested: boolean) => {
    if (ts.isIdentifier(node)) {
      if (!isReference(node)) return;
      if (OWN_BINDING.has(node.text)) own = true;
      else if (free(node.text)) {
        refs.add(node.text);
        if (nested) inClosure.add(node.text);
      }
      return;
    }
    if (
      node.kind === ts.SyntaxKind.ThisKeyword ||
      node.kind === ts.SyntaxKind.SuperKeyword ||
      ts.isMetaProperty(node)
    )
      own = true;
    if (!nested) {
      if (ts.isReturnStatement(node)) returns = true;
      if (ts.isYieldExpression(node)) yields = true;
      if (
        ts.isAwaitExpression(node) ||
        (ts.isForOfStatement(node) && node.awaitModifier)
      )
        awaits = true;
    }
    if (ts.isBinaryExpression(node) && isAssignment(node.operatorToken.kind))
      write(node.left);
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken)
    )
      write(node.operand);
    if (
      (ts.isForInStatement(node) || ts.isForOfStatement(node)) &&
      !ts.isVariableDeclarationList(node.initializer)
    )
      write(node.initializer);
    const children = () =>
      ts.forEachChild(node, (child) =>
        visit(child, nested || opensScope(node)),
      );
    if (opensScope(node)) {
      const fn = node as ts.SignatureDeclaration & { body?: ts.Node };
      const names = (fn.parameters ?? []).flatMap((p) =>
        bindingIdentifiers(p.name),
      );
      if (ts.isFunctionExpression(node) && node.name)
        names.push(node.name.text);
      if (fn.body && ts.isBlock(fn.body))
        names.push(
          ...varNames(fn.body.statements),
          ...blockNames(fn.body.statements),
        );
      if (ts.isClassStaticBlockDeclaration(node))
        names.push(
          ...varNames(node.body.statements),
          ...blockNames(node.body.statements),
        );
      within(names, children);
    } else if (ts.isBlock(node)) within(blockNames(node.statements), children);
    else if (ts.isCaseBlock(node))
      within(
        node.clauses.flatMap((c) => blockNames(c.statements)),
        children,
      );
    else if (
      (ts.isForStatement(node) ||
        ts.isForInStatement(node) ||
        ts.isForOfStatement(node)) &&
      node.initializer &&
      ts.isVariableDeclarationList(node.initializer) &&
      node.initializer.flags & ts.NodeFlags.BlockScoped
    )
      within(
        node.initializer.declarations.flatMap((d) =>
          bindingIdentifiers(d.name),
        ),
        children,
      );
    else if (ts.isCatchClause(node) && node.variableDeclaration)
      within(bindingIdentifiers(node.variableDeclaration.name), children);
    else children();
  };
  for (const node of nodes) visit(node, false);
  return { refs, assigned, inClosure, returns, yields, awaits, own };
}

/** The function around a node, or undefined at module level (a class
 *  counts as one: a method's `this` is its own). */
function enclosingFunction(node: ts.Node): ts.Node | undefined {
  for (let up = node.parent; up && !ts.isSourceFile(up); up = up.parent)
    if (opensScope(up) || ts.isClassLike(up)) return up;
  return undefined;
}

/**
 * A function the stage may be cut from: a function with a block body and
 * no function around it (its scope is its own and the module's), or
 * (owner Q18) an arrow or function expression with a block body passed
 * straight as a call's argument inside one (`people.map(async (p) => {…})`),
 * whose outer names a stage reads only as parameters too.
 */
function stageSource(node: ts.Node): node is BlockFunction {
  if (
    !ts.isFunctionDeclaration(node) &&
    !ts.isFunctionExpression(node) &&
    !ts.isArrowFunction(node)
  )
    return false;
  if (!node.body || !ts.isBlock(node.body) || node.asteriskToken) return false;
  const around = enclosingFunction(node);
  if (around === undefined) return true;
  return (
    !ts.isFunctionDeclaration(node) &&
    ts.isCallExpression(node.parent) &&
    node.parent.arguments.some((a) => a === node) &&
    stageSource(around)
  );
}

/** A source function's name: its own, or its variable's. */
function functionName(node: BlockFunction): string | undefined {
  if (node.name && ts.isIdentifier(node.name)) return node.name.text;
  const up = node.parent;
  if (ts.isVariableDeclaration(up) && ts.isIdentifier(up.name))
    return up.name.text;
  return undefined;
}

/**
 * Each stage source in a file with a key that names it on both sides of a
 * change: a top-level function by its name, a callback by the key of the
 * function around it, its call's callee and argument place, and which such
 * callback it is there in source order (`computeX > people.map(0) #1`).
 */
function stageSources(
  source: ts.SourceFile,
): { node: BlockFunction; key: string }[] {
  const out: { node: BlockFunction; key: string }[] = [];
  const keys = new Map<ts.Node, string>();
  const seen = new Map<string, number>();
  const visit = (node: ts.Node) => {
    if (stageSource(node)) {
      const around = enclosingFunction(node);
      let key: string | undefined;
      if (around === undefined) key = functionName(node);
      else {
        const call = node.parent as ts.CallExpression;
        const label = `${keys.get(around)} > ${call.expression.getText(source)}(${call.arguments.findIndex((arg) => arg === node)})`;
        const n = (seen.get(label) ?? 0) + 1;
        seen.set(label, n);
        key = keys.get(around) === undefined ? undefined : `${label} #${n}`;
      }
      if (key !== undefined) {
        keys.set(node, key);
        out.push({ node, key });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

/**
 * The names a callback's run sees from the functions and blocks around the
 * callback (their parameters, and what they declare), and every name
 * assigned anywhere in the outermost one.
 */
function outerScope(fn: ts.Node): {
  names: Set<string>;
  assigned: Set<string>;
  outermost: ts.Node | undefined;
} {
  const names = new Set<string>();
  let outermost: ts.Node | undefined;
  for (let up = fn.parent; up && !ts.isSourceFile(up); up = up.parent) {
    if (ts.isBlock(up) || ts.isModuleBlock(up))
      blockNames(up.statements).forEach((n) => names.add(n));
    else if (ts.isCaseBlock(up))
      up.clauses.forEach((c) =>
        blockNames(c.statements).forEach((n) => names.add(n)),
      );
    else if (
      (ts.isForStatement(up) ||
        ts.isForInStatement(up) ||
        ts.isForOfStatement(up)) &&
      up.initializer &&
      ts.isVariableDeclarationList(up.initializer)
    )
      up.initializer.declarations.forEach((d) =>
        bindingIdentifiers(d.name).forEach((n) => names.add(n)),
      );
    else if (ts.isCatchClause(up) && up.variableDeclaration)
      bindingIdentifiers(up.variableDeclaration.name).forEach((n) =>
        names.add(n),
      );
    else if (opensScope(up)) {
      const f = up as ts.SignatureDeclaration & { body?: ts.Node };
      for (const p of f.parameters ?? [])
        bindingIdentifiers(p.name).forEach((n) => names.add(n));
      if (ts.isFunctionExpression(up) && up.name) names.add(up.name.text);
      if (f.body && ts.isBlock(f.body))
        varNames(f.body.statements).forEach((n) => names.add(n));
      outermost = up;
    }
  }
  const assigned = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isBinaryExpression(node) && isAssignment(node.operatorToken.kind))
      targetNames(node.left).forEach((n) => assigned.add(n));
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken)
    )
      targetNames(node.operand).forEach((n) => assigned.add(n));
    if (
      (ts.isForInStatement(node) || ts.isForOfStatement(node)) &&
      !ts.isVariableDeclarationList(node.initializer)
    )
      targetNames(node.initializer).forEach((n) => assigned.add(n));
    ts.forEachChild(node, visit);
  };
  if (outermost) visit(outermost);
  return { names, assigned, outermost };
}

/**
 * The call a stage leaves: `fn(a, b);` when it returns nothing, else
 * `const { x, y } = fn(a, b);` (or `let`), awaited when the stage is
 * async; the arguments are the stage's parameters by name, and the names
 * bound are the ones it returns.
 */
function callsStage(
  statement: ts.Statement,
  stage: ts.FunctionDeclaration,
  params: string[],
  returned: string[],
): boolean {
  let call: ts.Expression | undefined;
  if (ts.isExpressionStatement(statement)) {
    if (returned.length > 0) return false;
    call = statement.expression;
  } else if (ts.isVariableStatement(statement)) {
    if (returned.length === 0) return false;
    if ((ts.getModifiers(statement) ?? []).length > 0) return false;
    const list = statement.declarationList;
    if (!(list.flags & ts.NodeFlags.BlockScoped)) return false;
    if (list.declarations.length !== 1) return false;
    const decl = list.declarations[0]!;
    if (decl.type || decl.exclamationToken) return false;
    if (!ts.isObjectBindingPattern(decl.name)) return false;
    const bound: string[] = [];
    for (const el of decl.name.elements) {
      if (el.dotDotDotToken || el.propertyName || el.initializer) return false;
      if (!ts.isIdentifier(el.name)) return false;
      bound.push(el.name.text);
    }
    if (new Set(bound).size !== bound.length) return false;
    if ([...bound].sort().join() !== [...returned].sort().join()) return false;
    call = decl.initializer;
  }
  if (!call) return false;
  if (isAsync(stage)) {
    if (!ts.isAwaitExpression(call)) return false;
    call = call.expression;
  }
  if (!ts.isCallExpression(call)) return false;
  if (call.typeArguments || call.questionDotToken) return false;
  if (!ts.isIdentifier(call.expression)) return false;
  if (call.expression.text !== stage.name?.text) return false;
  if (call.arguments.length !== params.length) return false;
  return call.arguments.every(
    (a, i) => ts.isIdentifier(a) && a.text === params[i],
  );
}

/**
 * A new top-level function that may hold a stage: a plain or exported,
 * plain or async function declaration, alone on its lines, every line
 * added, with plain named parameters (types allowed, no defaults or rest)
 * and no type parameters. Its statements are the moved ones, then at most
 * a `return { … }` of shorthand names, with only blank lines after them.
 */
function stageDestination(
  statement: ts.Statement,
  side: DiffSide,
  source: ts.SourceFile,
  oldNames: Set<string>,
):
  | {
      node: ts.FunctionDeclaration & { body: ts.Block };
      params: string[];
      moved: ts.Statement[];
      returned: string[];
      ret?: ts.ReturnStatement;
    }
  | undefined {
  if (!ts.isFunctionDeclaration(statement)) return undefined;
  if (!statement.name || !statement.body || statement.asteriskToken)
    return undefined;
  if (statement.typeParameters) return undefined;
  const modifiers = ts.getModifiers(statement) ?? [];
  const allowed = [ts.SyntaxKind.ExportKeyword, ts.SyntaxKind.AsyncKeyword];
  if (modifiers.some((m) => !allowed.includes(m.kind))) return undefined;
  const start = statement.getStart(source);
  const end = statement.getEnd();
  const at = (pos: number) => source.getLineAndCharacterOfPosition(pos);
  if (at(start).character !== 0) return undefined;
  if (!BLANK_LINE.test(side.lines[at(end).line]!.slice(at(end).character)))
    return undefined;
  // New in this change: no top-level function of its name before it.
  if (oldNames.has(statement.name.text)) return undefined;
  const params: string[] = [];
  for (const p of statement.parameters) {
    if (p.initializer || p.dotDotDotToken || p.questionToken) return undefined;
    if (!ts.isIdentifier(p.name) || p.name.text === "this") return undefined;
    params.push(p.name.text);
  }
  if (new Set(params).size !== params.length) return undefined;
  const statements = [...statement.body.statements];
  const last = statements[statements.length - 1];
  let returned: string[] = [];
  let ret: ts.ReturnStatement | undefined;
  if (last && ts.isReturnStatement(last)) {
    const value = last.expression;
    if (!value || !ts.isObjectLiteralExpression(value)) return undefined;
    if (value.properties.length === 0) return undefined;
    for (const p of value.properties) {
      if (!ts.isShorthandPropertyAssignment(p) || p.objectAssignmentInitializer)
        return undefined;
      returned.push(p.name.text);
    }
    if (new Set(returned).size !== returned.length) return undefined;
    ret = last;
    statements.pop();
  } else returned = [];
  if (statements.length === 0) return undefined;
  // Nothing but blank lines after the moved statements, besides the return.
  const lastEnd = at(statements[statements.length - 1]!.getEnd());
  const close = at(statement.body.getEnd()).line;
  const [retFirst, retLast] = ret
    ? [at(ret.getStart(source)).line, at(ret.getEnd()).line]
    : [close, close];
  if (!BLANK_LINE.test(side.lines[lastEnd.line]!.slice(lastEnd.character)))
    return undefined;
  for (let l = lastEnd.line + 1; l < close; l++)
    if ((l < retFirst || l > retLast) && !BLANK_LINE.test(side.lines[l]!))
      return undefined;
  return {
    node: statement as ts.FunctionDeclaration & { body: ts.Block },
    params,
    moved: statements,
    returned,
    ret,
  };
}

/**
 * Why a run of a function's statements can't be read as a stage taking
 * `params` and returning `returned`, or undefined when it can. The run may
 * read the function's own names (its parameters and what its body
 * declares) only through the stage's parameters, and never assign one; a
 * function it creates may not read one that is assigned elsewhere in the
 * function (it would see a copy). Every name it declares that the rest of
 * the function reads comes back in the return (a `var` or a function
 * declaration not at all: they hoist), and a `let` that comes back is
 * read by no function the run creates. It doesn't return, yield or read
 * its own `this`, and awaits exactly when the stage is async.
 */
function stageProblem(
  fn: BlockFunction,
  start: number,
  count: number,
  params: string[],
  returned: string[],
  async: boolean,
): string | undefined {
  const body = fn.body.statements;
  const run = body.slice(start, start + count);
  const rest = [...body.slice(0, start), ...body.slice(start + count)];
  const moved = scopeFacts(run);
  if (moved.returns) return "returns";
  if (moved.yields) return "yields";
  if (moved.own) return "reads its own this, arguments or super";
  if (moved.awaits !== async) return "awaits only on one side";
  // The function's own names at the cut.
  const visible = new Set<string>();
  for (const p of fn.parameters)
    bindingIdentifiers(p.name).forEach((n) => visible.add(n));
  if (ts.isFunctionExpression(fn) && fn.name) visible.add(fn.name.text);
  for (const s of rest) declaredBy(s).names.forEach((n) => visible.add(n));
  varNames(rest).forEach((n) => visible.add(n));
  // A callback's run also sees the names around it (owner Q18). One it
  // takes as a parameter is a copy: refused when anything in the outermost
  // function assigns that name (the callback may run later, or between
  // awaits, and would then read the new value).
  const outer = outerScope(fn);
  const own = new Set(visible);
  outer.names.forEach((n) => visible.add(n));
  const declared = new Map<string, { hoists: boolean; mutable: boolean }>();
  for (const n of varNames(run))
    declared.set(n, { hoists: true, mutable: true });
  for (const s of run) {
    const d = declaredBy(s);
    for (const n of d.names) declared.set(n, d);
  }
  const passed = new Set(params);
  for (const n of moved.refs)
    if (visible.has(n) && !declared.has(n) && !passed.has(n))
      return `reads ${n} without it as a parameter`;
  for (const n of moved.assigned)
    if (passed.has(n)) return `assigns its parameter ${n}`;
  for (const n of moved.refs)
    if (
      passed.has(n) &&
      outer.names.has(n) &&
      !own.has(n) &&
      outer.assigned.has(n)
    )
      return `reads ${n} from around the callback, which is assigned there`;
  const outside = scopeFacts(rest);
  for (const n of moved.inClosure)
    if (passed.has(n) && outside.assigned.has(n))
      return `a function it creates reads ${n}, which is assigned elsewhere`;
  for (const n of returned)
    if (!declared.has(n)) return `returns ${n}, which it doesn't declare`;
  const back = new Set(returned);
  for (const [n, d] of declared) {
    if (!outside.refs.has(n)) continue;
    if (d.hoists) return `${n} hoists, and the rest of the function reads it`;
    if (!back.has(n)) return `the rest of the function reads ${n}`;
  }
  for (const n of returned)
    if (declared.get(n)!.mutable && moved.inClosure.has(n))
      return `returns ${n}, which a function it creates reads`;
  return undefined;
}

/** Lines with each span cut to its text (a whole-line span with no text goes). */
function cutLines(
  lines: string[],
  source: ts.SourceFile,
  spans: Span[],
): string[] {
  const out: string[] = [];
  const at = (pos: number) => source.getLineAndCharacterOfPosition(pos);
  let i = 0;
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    const s = at(span.start);
    const e = at(span.end);
    for (; i < s.line; i++) out.push(lines[i]!);
    const merged =
      lines[s.line]!.slice(0, s.character) +
      span.text +
      lines[e.line]!.slice(e.character);
    if (span.text !== "" || !BLANK_LINE.test(merged)) out.push(merged);
    i = e.line + 1;
  }
  for (; i < lines.length; i++) out.push(lines[i]!);
  return out;
}

/**
 * Both sides of a file diffed again, line by line (the longest in-order
 * match, after the common head and tail): each run of unmatched lines
 * between two matched ones is one change group, numbered from `base`.
 */
function rediff(
  oldLines: string[],
  newLines: string[],
  base: number,
): { old: DiffSide; new: DiffSide } {
  let head = 0;
  while (
    head < oldLines.length &&
    head < newLines.length &&
    oldLines[head] === newLines[head]
  )
    head += 1;
  let tail = 0;
  while (
    tail < oldLines.length - head &&
    tail < newLines.length - head &&
    oldLines[oldLines.length - 1 - tail] ===
      newLines[newLines.length - 1 - tail]
  )
    tail += 1;
  const pairs: [number, number][] = [];
  for (let k = 0; k < head; k++) pairs.push([k, k]);
  for (const [a, b] of inOrder(
    oldLines.slice(head, oldLines.length - tail),
    newLines.slice(head, newLines.length - tail),
  ))
    pairs.push([a + head, b + head]);
  for (let k = tail; k > 0; k--)
    pairs.push([oldLines.length - k, newLines.length - k]);
  const old: DiffSide = { lines: oldLines, changed: [] };
  const next: DiffSide = { lines: newLines, changed: [] };
  let group = base;
  let [i, j] = [0, 0];
  const ends: [number, number][] = [
    ...pairs,
    [oldLines.length, newLines.length],
  ];
  for (const [a, b] of ends) {
    if (i < a || j < b) {
      group += 1;
      for (; i < a; i++) old.changed.push({ at: i, group });
      for (; j < b; j++) next.changed.push({ at: j, group });
    }
    [i, j] = [a + 1, b + 1];
  }
  return { old, new: next };
}

/** How many comment lines stand right above `line`. */
function commentsAbove(lines: string[], line: number): number {
  let n = 0;
  while (line - n > 0 && COMMENT_LINE.test(lines[line - n - 1]!)) n += 1;
  return n;
}

/**
 * Finds each stage cut from a long function (owner v0.10.3 Q1) and cuts it
 * out of both sides: the moved statements and the call left in their place
 * become one marker, and the stage goes (its doc comment stays a comment).
 * The statements are contiguous top-level statements of one function's
 * body, in the stage in the same order, token for token (stageDestination,
 * stageProblem); the call is a top-level statement of the same-named
 * function; the stage is a function new in this change, in another file or
 * the same one. The stages are found from the syntax, not from git's line
 * diff (which may match a `);` or `x,` of the call to one of the run's, or,
 * in one file, the moved lines to themselves): once cut, each file the cuts
 * touch is diffed again line by line, so a marker left anywhere but where
 * the run was, or anything else changed, is read as any other changed
 * line. Returns how many statements moved (within a file too), and each
 * stage.
 */
function cutMovedStages(
  files: FileDiff[],
  names?: RegExp,
): { movedAcross: number; moves: StageMove[] } {
  const code = files
    .map((entry) => ({
      entry,
      oldSource: parseSide(entry.file, entry.old),
      newSource: parseSide(entry.file, entry.new),
    }))
    .filter(
      ({ entry }) =>
        CODE_FILE.test(entry.file) && !MOVE_BOOKKEEPING.test(entry.file),
    );
  const keyOf = (s: ts.Statement, source: ts.SourceFile) =>
    tokensOf(s, source, names).join(" ");
  const sources: {
    f: number;
    node: BlockFunction;
    name: string;
    keys: string[];
  }[] = [];
  const dests: {
    f: number;
    dest: NonNullable<ReturnType<typeof stageDestination>>;
    keys: string[];
  }[] = [];
  code.forEach(({ entry, oldSource, newSource }, f) => {
    for (const { node, key } of stageSources(oldSource))
      sources.push({
        f,
        node,
        name: key,
        keys: node.body.statements.map((s) => keyOf(s, oldSource)),
      });
    const oldNames = new Set(
      oldSource.statements.flatMap((s) =>
        ts.isFunctionDeclaration(s) && s.name ? [s.name.text] : [],
      ),
    );
    for (const statement of newSource.statements) {
      const dest = stageDestination(statement, entry.new, newSource, oldNames);
      if (dest)
        dests.push({
          f,
          dest,
          keys: dest.moved.map((s) => keyOf(s, newSource)),
        });
    }
  });

  const spans = code.map(() => ({ old: [] as Span[], new: [] as Span[] }));
  const lineOf = (source: ts.SourceFile, pos: number) =>
    source.getLineAndCharacterOfPosition(pos).line;
  const free = (taken: Span[], source: ts.SourceFile, s: number, e: number) =>
    taken.every(
      (t) =>
        lineOf(source, e) < lineOf(source, t.start) ||
        lineOf(source, s) > lineOf(source, t.end),
    );
  const claimedCalls = new Set<ts.Statement>();
  const moves: StageMove[] = [];
  let moved = 0;
  let marker = 0;
  for (const { f: d, dest, keys } of dests) {
    const to = code[d]!;
    let found = false;
    for (const source of sources) {
      if (found) break;
      const at = code[source.f]!;
      const name = source.name;
      const body = source.node.body.statements;
      for (let i = 0; i + keys.length <= body.length && !found; i++) {
        if (keys.some((k, j) => source.keys[i + j] !== k)) continue;
        const first = body[i]!;
        const last = body[i + keys.length - 1]!;
        const e = { start: first.getStart(at.oldSource), end: last.getEnd() };
        if (
          stageProblem(
            source.node,
            i,
            keys.length,
            dest.params,
            dest.returned,
            isAsync(dest.node),
          ) !== undefined ||
          movedCommentsProblem(
            commentsOfRun(body.slice(i, i + keys.length), at.oldSource),
            commentsOfRun(dest.moved, to.newSource),
          ) !== undefined
        )
          continue;
        // The call, inside the function of that key (the same callback):
        // the one with the run's neighbours around it when there are
        // several.
        const before = source.keys[i - 1];
        const after = source.keys[i + keys.length];
        let call: ts.Statement | undefined;
        const there = stageSources(at.newSource).find((x) => x.key === name);
        if (there) {
          const list = there.node.body.statements;
          const calls = list.filter(
            (s) =>
              !claimedCalls.has(s) &&
              callsStage(s, dest.node, dest.params, dest.returned),
          );
          const fits = (s: ts.Statement) => {
            const k = list.indexOf(s);
            const prev = list[k - 1];
            const next = list[k + 1];
            return (
              (prev ? keyOf(prev, at.newSource) : undefined) === before ||
              (next ? keyOf(next, at.newSource) : undefined) === after
            );
          };
          call = calls.find(fits) ?? calls[0];
        }
        if (!call) continue;
        const r = { start: call.getStart(at.newSource), end: call.getEnd() };
        const ds = {
          start: dest.node.getStart(to.newSource),
          end: dest.node.getEnd(),
        };
        if (
          !free(spans[source.f]!.old, at.oldSource, e.start, e.end) ||
          !free(spans[source.f]!.new, at.newSource, r.start, r.end) ||
          !free(spans[d]!.new, to.newSource, ds.start, ds.end) ||
          (source.f === d &&
            !(
              lineOf(to.newSource, r.end) < lineOf(to.newSource, ds.start) ||
              lineOf(to.newSource, r.start) > lineOf(to.newSource, ds.end)
            ))
        )
          continue;
        marker += 1;
        const text = `__movedStage${marker}__`;
        spans[source.f]!.old.push({ ...e, text });
        spans[source.f]!.new.push({ ...r, text });
        spans[d]!.new.push({ ...ds, text: "" });
        claimedCalls.add(call);
        moved += keys.length;
        // The moved lines at each side: in the old file with the comment
        // lines above them that no longer stand above the call, in the
        // stage from its `{`.
        const oldLines = at.entry.old.lines;
        const firstLine = lineOf(at.oldSource, e.start);
        const left = Math.max(
          0,
          commentsAbove(oldLines, firstLine) -
            commentsAbove(at.entry.new.lines, lineOf(at.newSource, r.start)),
        );
        const oldRun = oldLines.slice(
          firstLine - left,
          lineOf(at.oldSource, e.end) + 1,
        );
        const open = lineOf(
          to.newSource,
          dest.node.body.getStart(to.newSource),
        );
        const movedEnd = lineOf(
          to.newSource,
          dest.moved[dest.moved.length - 1]!.getEnd(),
        );
        const newRun = to.entry.new.lines.slice(open + 1, movedEnd + 1);
        const all =
          lineOf(to.newSource, ds.end) - lineOf(to.newSource, ds.start) + 1;
        const codeIn = (lines: string[]) =>
          lines.filter((l) => !BLANK_LINE.test(l)).length;
        moves.push({
          from: at.entry.file,
          to: to.entry.file,
          start: at.oldSource.getLineAndCharacterOfPosition(
            source.node.getStart(at.oldSource),
          ),
          name: dest.node.name!.text,
          wrapper: {
            old:
              lineOf(at.newSource, r.end) - lineOf(at.newSource, r.start) + 1,
            new: all - newRun.length,
          },
          body: { old: oldRun.length, new: newRun.length },
          bodyCode: { old: codeIn(oldRun), new: codeIn(newRun) },
          statements: keys.length,
          returned: dest.returned,
        });
        found = true;
      }
    }
  }
  code.forEach(({ entry, oldSource, newSource }, f) => {
    if (spans[f]!.old.length + spans[f]!.new.length === 0) return;
    const sides = rediff(
      cutLines(entry.old.lines, oldSource, spans[f]!.old),
      cutLines(entry.new.lines, newSource, spans[f]!.new),
      1_000_000 * (f + 1),
    );
    entry.old = sides.old;
    entry.new = sides.new;
  });
  return { movedAcross: moved, moves };
}

/**
 * A UI cut (owner v0.10.4 Q3): an immediately-invoked arrow inside JSX
 * whose body moved unchanged into a new top-level function, called in its
 * place with the names it captured (`kind: "iife"`), or a contiguous run
 * of JSX children moved unchanged into a new top-level component,
 * rendered in its place with those names as same-named props (`kind:
 * "jsx"`). `start` is where the arrow or the run started in the old file,
 * `wrapper.new` the lines the function adds around what it took,
 * `wrapper.old` the lines of the call left in its place.
 */
export type UiMove = BodyMove & { kind: "iife" | "jsx"; params: string[] };

/** A React hook's name: `use`, `useX`. */
const HOOK_NAME = /^use([A-Z0-9]|$)/;

/** Whether a node calls a hook (`useX(…)`, `trpc.a.b.useQuery(…)`) anywhere inside. */
function callsHook(node: ts.Node): boolean {
  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    const name = ts.isIdentifier(callee)
      ? callee.text
      : ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : undefined;
    if (name !== undefined && HOOK_NAME.test(name)) return true;
  }
  return ts.forEachChild(node, callsHook) === true;
}

/** A JSX element's attributes, or undefined for any other node. */
function jsxAttributes(node: ts.Node): ts.JsxAttributes | undefined {
  if (ts.isJsxElement(node)) return node.openingElement.attributes;
  if (ts.isJsxSelfClosingElement(node)) return node.attributes;
  return undefined;
}

/** A JSX element with a `key`: React reads it in its parent's list. */
const hasKey = (node: ts.Node) =>
  jsxAttributes(node)?.properties.some(
    (p) =>
      ts.isJsxAttribute(p) && ts.isIdentifier(p.name) && p.name.text === "key",
  ) === true;

/** An element's or fragment's children, without whitespace-only text. */
function jsxChildren(node: ts.JsxElement | ts.JsxFragment): ts.JsxChild[] {
  return node.children.filter(
    (c) => !ts.isJsxText(c) || jsxTextValue(c.text) !== "",
  );
}

/** `(() => { … })()`: the arrow, with no parameters and a block body. */
function iifeArrow(
  node: ts.Node,
): (ts.ArrowFunction & { body: ts.Block }) | undefined {
  if (!ts.isCallExpression(node) || node.arguments.length > 0) return undefined;
  if (node.typeArguments || node.questionDotToken) return undefined;
  if (!ts.isParenthesizedExpression(node.expression)) return undefined;
  const fn = node.expression.expression;
  if (!ts.isArrowFunction(fn) || !ts.isBlock(fn.body)) return undefined;
  if (fn.parameters.length > 0 || fn.typeParameters || isAsync(fn))
    return undefined;
  if (fn.body.statements.length === 0) return undefined;
  return fn as ts.ArrowFunction & { body: ts.Block };
}

/** Whether a node sits inside a JSX expression (`{…}`, `attr={…}`). */
function insideJsx(node: ts.Node): boolean {
  for (let up = node.parent; up && !ts.isSourceFile(up); up = up.parent)
    if (ts.isJsxExpression(up)) return true;
  return false;
}

/** Whether a return of `nodes` (their own, not a nested function's) gives
 *  an element with a `key`. */
function returnsKeyed(nodes: readonly ts.Node[]): boolean {
  const visit = (n: ts.Node): boolean => {
    if (opensScope(n)) return false;
    if (ts.isReturnStatement(n) && n.expression) {
      let e: ts.Expression = n.expression;
      while (ts.isParenthesizedExpression(e)) e = e.expression;
      if (hasKey(e)) return true;
    }
    return ts.forEachChild(n, visit) === true;
  };
  return nodes.some(visit);
}

/**
 * Why code cut from where `at` stands can't take exactly `params` as the
 * names it captures, or undefined when it can: every name it reads from
 * the functions and blocks around it (not one it declares itself, `own`)
 * is a parameter, and only those are; it assigns none of them, and no
 * function it creates reads one that is assigned around it (it would see a
 * copy); it reads no `this`, awaits or yields nothing, and calls no hook
 * (a hook moved into a component runs on that component's mount).
 */
function capturedProblem(
  nodes: readonly ts.Node[],
  at: ts.Node,
  params: string[],
  own: Set<string>,
): string | undefined {
  const facts = scopeFacts(nodes);
  if (facts.own) return "reads its own this, arguments or super";
  if (facts.awaits || facts.yields) return "awaits or yields";
  if (nodes.some(callsHook)) return "calls a hook";
  const outer = outerScope(at);
  const needed = new Set(
    [...facts.refs].filter((n) => outer.names.has(n) && !own.has(n)),
  );
  const passed = new Set(params);
  for (const n of needed)
    if (!passed.has(n)) return `reads ${n} without it as a parameter`;
  for (const n of passed)
    if (!needed.has(n))
      return `takes ${n}, which it doesn't read from around it`;
  for (const n of facts.assigned)
    if (passed.has(n)) return `assigns its parameter ${n}`;
  for (const n of facts.inClosure)
    if (passed.has(n) && outer.assigned.has(n))
      return `a function it creates reads ${n}, which is assigned around it`;
  return undefined;
}

/** A statement alone on its lines from column 0, every line added. */
function aloneAndAdded(
  statement: ts.Statement,
  side: DiffSide,
  source: ts.SourceFile,
): boolean {
  const start = statement.getStart(source);
  const end = statement.getEnd();
  const at = (pos: number) => source.getLineAndCharacterOfPosition(pos);
  if (at(start).character !== 0) return false;
  if (!BLANK_LINE.test(side.lines[at(end).line]!.slice(at(end).character)))
    return false;
  return allChanged(side, source, start, end);
}

/** The names a file's top-level statements declare, types too. */
function topLevelNames(source: ts.SourceFile): Set<string> {
  const out = new Set<string>();
  for (const s of source.statements) {
    declaredBy(s).names.forEach((n) => out.add(n));
    if (ts.isTypeAliasDeclaration(s) || ts.isInterfaceDeclaration(s))
      out.add(s.name.text);
  }
  return out;
}

type NamedFunction = ts.FunctionDeclaration & {
  body: ts.Block;
  name: ts.Identifier;
};

/** A new top-level function a UI cut may land in: plain or exported, not
 *  async or a generator, no type parameters, alone on its lines, every
 *  line added, its name new to the file. */
function newTopLevelFunction(
  statement: ts.Statement,
  side: DiffSide,
  source: ts.SourceFile,
  oldNames: Set<string>,
): NamedFunction | undefined {
  if (!ts.isFunctionDeclaration(statement)) return undefined;
  if (!statement.name || !statement.body || statement.asteriskToken)
    return undefined;
  if (statement.typeParameters) return undefined;
  const modifiers = ts.getModifiers(statement) ?? [];
  if (modifiers.some((m) => m.kind !== ts.SyntaxKind.ExportKeyword))
    return undefined;
  if (oldNames.has(statement.name.text)) return undefined;
  if (!aloneAndAdded(statement, side, source)) return undefined;
  return statement as NamedFunction;
}

/** Plain named parameters (types allowed; no default, rest or `?`). */
function plainParams(
  params: readonly ts.ParameterDeclaration[],
): string[] | undefined {
  const out: string[] = [];
  for (const p of params) {
    if (p.initializer || p.dotDotDotToken || p.questionToken) return undefined;
    if (!ts.isIdentifier(p.name) || p.name.text === "this") return undefined;
    out.push(p.name.text);
  }
  return new Set(out).size === out.length ? out : undefined;
}

/** A component's props: its one parameter `{ a, b }` (typed or not), or none. */
function componentProps(fn: ts.FunctionDeclaration): string[] | undefined {
  if (fn.parameters.length === 0) return [];
  const [p, ...rest] = fn.parameters;
  if (!p || rest.length > 0) return undefined;
  if (p.initializer || p.dotDotDotToken || p.questionToken) return undefined;
  if (!ts.isObjectBindingPattern(p.name)) return undefined;
  const out: string[] = [];
  for (const el of p.name.elements) {
    if (el.dotDotDotToken || el.propertyName || el.initializer)
      return undefined;
    if (!ts.isIdentifier(el.name)) return undefined;
    out.push(el.name.text);
  }
  return new Set(out).size === out.length ? out : undefined;
}

/** What a component renders, `return <X …/>;` or `return (<>…</>);`, as
 *  the runs of JSX it may have taken: the element, or a fragment's children. */
function renderedRuns(fn: NamedFunction): ts.Node[][] {
  const [only, ...rest] = fn.body.statements;
  if (!only || rest.length > 0 || !ts.isReturnStatement(only)) return [];
  let e = only.expression;
  while (e && ts.isParenthesizedExpression(e)) e = e.expression;
  if (!e) return [];
  if (ts.isJsxFragment(e)) return [jsxChildren(e), [e]];
  if (ts.isJsxElement(e) || ts.isJsxSelfClosingElement(e)) return [[e]];
  return [];
}

/** The props type a new component names, declared new right above it. */
function propsTypeOf(
  fn: NamedFunction,
  source: ts.SourceFile,
  side: DiffSide,
  oldNames: Set<string>,
): ts.Statement | undefined {
  const type = fn.parameters[0]?.type;
  if (!type || !ts.isTypeReferenceNode(type) || type.typeArguments)
    return undefined;
  if (!ts.isIdentifier(type.typeName)) return undefined;
  const prev = source.statements[source.statements.indexOf(fn) - 1];
  if (
    !prev ||
    !(ts.isTypeAliasDeclaration(prev) || ts.isInterfaceDeclaration(prev)) ||
    prev.typeParameters ||
    prev.name.text !== type.typeName.text ||
    oldNames.has(prev.name.text)
  )
    return undefined;
  const modifiers = ts.getModifiers(prev) ?? [];
  if (modifiers.some((m) => m.kind !== ts.SyntaxKind.ExportKeyword))
    return undefined;
  return aloneAndAdded(prev, side, source) ? prev : undefined;
}

/** `fn(a, b)`, its arguments `fn`'s parameters by name, in order. */
function callsFunction(node: ts.Node, name: string, params: string[]) {
  return (
    ts.isCallExpression(node) &&
    !node.typeArguments &&
    !node.questionDotToken &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === name &&
    node.arguments.length === params.length &&
    node.arguments.every((a, i) => ts.isIdentifier(a) && a.text === params[i])
  );
}

/** `<Part a={a} b={b} />`: each prop once, by its own name, no `key`. */
function rendersComponent(node: ts.Node, name: string, props: string[]) {
  if (!ts.isJsxSelfClosingElement(node) || node.typeArguments) return false;
  if (!ts.isIdentifier(node.tagName) || node.tagName.text !== name)
    return false;
  const given: string[] = [];
  for (const p of node.attributes.properties) {
    if (!ts.isJsxAttribute(p) || !ts.isIdentifier(p.name)) return false;
    const value = p.initializer;
    if (!value || !ts.isJsxExpression(value) || value.dotDotDotToken)
      return false;
    if (!value.expression || !ts.isIdentifier(value.expression)) return false;
    if (value.expression.text !== p.name.text) return false;
    given.push(p.name.text);
  }
  return (
    new Set(given).size === given.length &&
    [...given].sort().join() === [...props].sort().join()
  );
}

/**
 * Finds each UI cut (owner v0.10.4 Q3) and cuts it out of both sides, as
 * cutMovedStages does a stage: the arrow or run and the call left in its
 * place become one marker, and the new function (with a component's props
 * type) goes. An arrow's body moves statement for statement, a run child
 * for child, token for token (comments and layout aside); capturedProblem
 * holds what they read. Each file the cuts touch is then diffed again
 * line by line, so a call left anywhere but where the code was, or
 * anything else changed, is read as any other changed line. Returns how
 * many statements or children moved, and each cut.
 */
function cutMovedUiParts(
  files: FileDiff[],
  names?: RegExp,
): { movedAcross: number; moves: UiMove[] } {
  const code = files
    .map((entry) => ({
      entry,
      oldSource: parseSide(entry.file, entry.old),
      newSource: parseSide(entry.file, entry.new),
    }))
    .filter(
      ({ entry }) =>
        CODE_FILE.test(entry.file) && !MOVE_BOOKKEEPING.test(entry.file),
    );
  const keyOf = (n: ts.Node, source: ts.SourceFile) =>
    tokensOf(n, source, names).join(" ");
  const iifes: {
    f: number;
    call: ts.CallExpression;
    arrow: ts.ArrowFunction & { body: ts.Block };
    keys: string[];
  }[] = [];
  const parents: { f: number; children: ts.JsxChild[]; keys: string[] }[] = [];
  const dests: {
    f: number;
    node: NamedFunction;
    kind: UiMove["kind"];
    params: string[];
    runs: { nodes: ts.Node[]; keys: string[] }[];
    props?: ts.Statement;
  }[] = [];
  code.forEach(({ entry, oldSource, newSource }, f) => {
    const visit = (node: ts.Node) => {
      const arrow = iifeArrow(node);
      if (
        arrow &&
        insideJsx(node) &&
        allChanged(
          entry.old,
          oldSource,
          node.getStart(oldSource),
          node.getEnd(),
        )
      )
        iifes.push({
          f,
          call: node as ts.CallExpression,
          arrow,
          keys: arrow.body.statements.map((s) => keyOf(s, oldSource)),
        });
      if (
        (ts.isJsxElement(node) || ts.isJsxFragment(node)) &&
        enclosingFunction(node) !== undefined
      ) {
        const children = jsxChildren(node);
        parents.push({
          f,
          children,
          keys: children.map((c) => keyOf(c, oldSource)),
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(oldSource);
    const oldNames = topLevelNames(oldSource);
    for (const statement of newSource.statements) {
      const fn = newTopLevelFunction(statement, entry.new, newSource, oldNames);
      if (!fn) continue;
      const params = plainParams(fn.parameters);
      if (params && !isAsync(fn)) {
        const nodes = [...fn.body.statements];
        dests.push({
          f,
          node: fn,
          kind: "iife",
          params,
          runs: [{ nodes, keys: nodes.map((s) => keyOf(s, newSource)) }],
        });
      }
      const props = componentProps(fn);
      const runs = renderedRuns(fn).filter((r) => r.length > 0);
      if (props && runs.length > 0 && !isAsync(fn))
        dests.push({
          f,
          node: fn,
          kind: "jsx",
          params: props,
          runs: runs.map((nodes) => ({
            nodes,
            keys: nodes.map((n) => keyOf(n, newSource)),
          })),
          props: propsTypeOf(fn, newSource, entry.new, oldNames),
        });
    }
  });

  const spans = code.map(() => ({ old: [] as Span[], new: [] as Span[] }));
  const lineOf = (source: ts.SourceFile, pos: number) =>
    source.getLineAndCharacterOfPosition(pos).line;
  const free = (taken: Span[], source: ts.SourceFile, s: number, e: number) =>
    taken.every(
      (t) =>
        lineOf(source, e) < lineOf(source, t.start) ||
        lineOf(source, s) > lineOf(source, t.end),
    );
  const groupOf = (side: DiffSide, line: number) =>
    side.changed.find((c) => c.at === line)?.group;
  const taken = new Set<ts.Node>();
  const moves: UiMove[] = [];
  let moved = 0;
  let marker = 0;
  for (const dest of dests) {
    if (taken.has(dest.node)) continue;
    const to = code[dest.f]!;
    const name = dest.node.name.text;
    // Each place the dest's code could have come from: an arrow's body,
    // or a window of an element's children.
    const candidates: {
      f: number;
      nodes: readonly ts.Node[];
      span: ts.Node[];
      run: ts.Node[];
      arrow?: ts.ArrowFunction & { body: ts.Block };
    }[] = [];
    if (dest.kind === "iife") {
      const keys = dest.runs[0]!.keys.join("\n");
      for (const s of iifes)
        if (!taken.has(s.call) && s.keys.join("\n") === keys)
          candidates.push({
            f: s.f,
            nodes: s.arrow.body.statements,
            span: [s.call],
            run: dest.runs[0]!.nodes,
            arrow: s.arrow,
          });
    } else
      for (const run of dest.runs)
        for (const p of parents)
          for (let i = 0; i + run.keys.length <= p.keys.length; i++) {
            if (run.keys.some((k, j) => p.keys[i + j] !== k)) continue;
            const nodes = p.children.slice(i, i + run.keys.length);
            if (taken.has(nodes[0]!)) continue;
            candidates.push({ f: p.f, nodes, span: nodes, run: run.nodes });
          }
    for (const c of candidates) {
      const at = code[c.f]!;
      const [first, last] = [c.span[0]!, c.span[c.span.length - 1]!];
      const e = { start: first.getStart(at.oldSource), end: last.getEnd() };
      if (!allChanged(at.entry.old, at.oldSource, e.start, e.end)) continue;
      const own = new Set<string>();
      if (c.arrow) {
        varNames(c.nodes).forEach((n) => own.add(n));
        for (const s of c.arrow.body.statements)
          declaredBy(s).names.forEach((n) => own.add(n));
        if (returnsKeyed(c.nodes)) continue;
      } else if (c.nodes.some(hasKey)) continue;
      if (capturedProblem(c.nodes, first, dest.params, own) !== undefined)
        continue;
      if (
        movedCommentsProblem(
          c.arrow
            ? commentsOfBody(c.arrow.body, at.oldSource)
            : commentsOfRun(c.nodes, at.oldSource),
          c.arrow
            ? commentsOfBody(dest.node.body, to.newSource)
            : commentsOfRun(c.run, to.newSource),
        ) !== undefined
      )
        continue;
      // The call, in the file the code left; the one in the code's change
      // group when there are several.
      const calls: ts.Node[] = [];
      const look = (n: ts.Node) => {
        if (
          !taken.has(n) &&
          (dest.kind === "iife"
            ? callsFunction(n, name, dest.params)
            : rendersComponent(n, name, dest.params)) &&
          allChanged(
            at.entry.new,
            at.newSource,
            n.getStart(at.newSource),
            n.getEnd(),
          )
        )
          calls.push(n);
        ts.forEachChild(n, look);
      };
      look(at.newSource);
      const group = groupOf(at.entry.old, lineOf(at.oldSource, e.start));
      const call =
        calls.find(
          (n) =>
            groupOf(
              at.entry.new,
              lineOf(at.newSource, n.getStart(at.newSource)),
            ) === group,
        ) ?? calls[0];
      if (!call) continue;
      const r = { start: call.getStart(at.newSource), end: call.getEnd() };
      const ds = [dest.props, dest.node]
        .filter((n): n is ts.Statement => n !== undefined)
        .map((n) => ({ start: n.getStart(to.newSource), end: n.getEnd() }));
      if (
        !free(spans[c.f]!.old, at.oldSource, e.start, e.end) ||
        !free(spans[c.f]!.new, at.newSource, r.start, r.end) ||
        ds.some(
          (d) => !free(spans[dest.f]!.new, to.newSource, d.start, d.end),
        ) ||
        (c.f === dest.f &&
          ds.some(
            (d) =>
              !(
                lineOf(to.newSource, r.end) < lineOf(to.newSource, d.start) ||
                lineOf(to.newSource, r.start) > lineOf(to.newSource, d.end)
              ),
          ))
      )
        continue;
      marker += 1;
      const text = `__movedUi${marker}__`;
      spans[c.f]!.old.push({ ...e, text });
      spans[c.f]!.new.push({ ...r, text });
      for (const d of ds) spans[dest.f]!.new.push({ ...d, text: "" });
      taken.add(dest.node);
      taken.add(call);
      c.span.forEach((n) => taken.add(n));
      moved += c.nodes.length;
      const lines = (source: ts.SourceFile, nodes: readonly ts.Node[]) => {
        const [a, b] = [nodes[0]!, nodes[nodes.length - 1]!];
        return (
          lineOf(source, b.getEnd()) - lineOf(source, a.getStart(source)) + 1
        );
      };
      const codeIn = (
        side: DiffSide,
        source: ts.SourceFile,
        nodes: readonly ts.Node[],
      ) => {
        const from = lineOf(source, nodes[0]!.getStart(source));
        return side.lines
          .slice(from, from + lines(source, nodes))
          .filter((l) => !BLANK_LINE.test(l)).length;
      };
      const all =
        lineOf(to.newSource, dest.node.getEnd()) -
        lineOf(to.newSource, dest.node.getStart(to.newSource)) +
        1;
      const was = c.arrow
        ? wrapperAndBody(c.arrow, at.oldSource, at.entry.old.lines)
        : {
            body: lines(at.oldSource, c.nodes),
            bodyCode: codeIn(at.entry.old, at.oldSource, c.nodes),
          };
      const now = c.arrow
        ? wrapperAndBody(dest.node, to.newSource, to.entry.new.lines)
        : {
            body: lines(to.newSource, c.run),
            bodyCode: codeIn(to.entry.new, to.newSource, c.run),
          };
      moves.push({
        from: at.entry.file,
        to: to.entry.file,
        start: at.oldSource.getLineAndCharacterOfPosition(
          (c.arrow ?? first).getStart(at.oldSource),
        ),
        name,
        wrapper: {
          old: lineOf(at.newSource, r.end) - lineOf(at.newSource, r.start) + 1,
          new: all - now.body,
        },
        body: { old: was.body, new: now.body },
        bodyCode: { old: was.bodyCode, new: now.bodyCode },
        kind: dest.kind,
        params: dest.params,
      });
      break;
    }
  }
  code.forEach(({ entry, oldSource, newSource }, f) => {
    if (spans[f]!.old.length + spans[f]!.new.length === 0) return;
    const sides = rediff(
      cutLines(entry.old.lines, oldSource, spans[f]!.old),
      cutLines(entry.new.lines, newSource, spans[f]!.new),
      1_000_000 * (f + 1),
    );
    entry.old = sides.old;
    entry.new = sides.new;
  });
  return { movedAcross: moved, moves };
}

const isExported = (s: ts.Statement) =>
  ts.canHaveModifiers(s) &&
  (ts.getModifiers(s) ?? []).some(
    (m) => m.kind === ts.SyntaxKind.ExportKeyword,
  );

/** The comments inside a statement (not the doc comment above it), in order,
 *  their spacing collapsed. */
function commentsIn(node: ts.Node, source: ts.SourceFile): string {
  const text = source.getFullText();
  const [start, end] = [node.getStart(source), node.getEnd()];
  const found = new Map<number, string>();
  const add = (ranges: ts.CommentRange[] | undefined) => {
    for (const r of ranges ?? [])
      if (r.pos >= start && r.end <= end)
        found.set(r.pos, text.slice(r.pos, r.end).replace(/\s+/g, " "));
  };
  const visit = (n: ts.Node) => {
    const children = n.getChildren(source);
    if (children.length > 0) children.forEach(visit);
    else {
      add(ts.getLeadingCommentRanges(text, n.getFullStart()));
      add(ts.getTrailingCommentRanges(text, n.getEnd()));
    }
  };
  visit(node);
  return [...found]
    .sort((a, b) => a[0] - b[0])
    .map(([, c]) => c)
    .join("\n");
}

/**
 * Owner v0.10.3 Q23: a moved top-level statement that gains `export`, which
 * prettier may then re-wrap (a signature past the print width), is read at
 * its old layout. A statement new in its file, every code line of it added,
 * whose tokens are `export` and then, token for token, those of a statement
 * that left its own file in this commit (not exported there, with the same
 * comments inside) is written back in that statement's lines with `export `
 * in front, in its place in the diff; the moved-line match then holds it to
 * the rules of any other moved statement (whole, in order). Any other token
 * added, dropped or changed leaves its lines as they are, read as changed
 * lines. A statement exported in place, or moved within its file, is not
 * read this way.
 */
function unwrapExported(files: FileDiff[], names?: RegExp): void {
  const code = files
    .map((entry) => ({
      entry,
      oldSource: parseSide(entry.file, entry.old),
      newSource: parseSide(entry.file, entry.new),
    }))
    .filter(
      ({ entry }) =>
        CODE_FILE.test(entry.file) && !MOVE_BOOKKEEPING.test(entry.file),
    );
  const keyOf = (s: ts.Statement, source: ts.SourceFile) =>
    tokensOf(s, source, names).join(" ");
  const left = new Map<string, { text: string; comments: string }[]>();
  for (const { oldSource, newSource } of code) {
    const kept = new Set(newSource.statements.map((s) => keyOf(s, newSource)));
    for (const s of oldSource.statements) {
      const key = keyOf(s, oldSource);
      if (isExported(s) || kept.has(key) || kept.has(`export ${key}`)) continue;
      left.set(key, [
        ...(left.get(key) ?? []),
        { text: s.getText(oldSource), comments: commentsIn(s, oldSource) },
      ]);
    }
  }
  for (const { entry, oldSource, newSource } of code) {
    const had = new Set(oldSource.statements.map((s) => keyOf(s, oldSource)));
    const spans: Span[] = [];
    for (const s of newSource.statements) {
      if (!isExported(s)) continue;
      const tokens = tokensOf(s, newSource, names);
      if (tokens[0] !== "export") continue;
      const key = tokens.slice(1).join(" ");
      if (had.has(key) || had.has(tokens.join(" "))) continue;
      if (!allChanged(entry.new, newSource, s.getStart(newSource), s.getEnd()))
        continue;
      const from = left.get(key) ?? [];
      const i = from.findIndex((o) => o.comments === commentsIn(s, newSource));
      if (i < 0) continue;
      const [old] = from.splice(i, 1);
      const text = `export ${old!.text}`;
      if (text !== s.getText(newSource))
        spans.push({ start: s.getStart(newSource), end: s.getEnd(), text });
    }
    if (spans.length === 0) continue;
    // Spliced into git's own diff: the old layout's lines take the place
    // of the new ones, in the change group of the statement's first line.
    const { lines, changed } = entry.new;
    const groupAt = new Map(changed.map((c) => [c.at, c.group]));
    const at = (pos: number) => newSource.getLineAndCharacterOfPosition(pos);
    const next: DiffSide = { lines: [], changed: [] };
    let l = 0;
    const keep = (to: number) => {
      for (; l < to; l++) {
        const group = groupAt.get(l);
        if (group !== undefined)
          next.changed.push({ at: next.lines.length, group });
        next.lines.push(lines[l]!);
      }
    };
    for (const span of spans) {
      const [s, e] = [at(span.start), at(span.end)];
      keep(s.line);
      const group = groupAt.get(s.line)!;
      const text =
        lines[s.line]!.slice(0, s.character) +
        span.text +
        lines[e.line]!.slice(e.character);
      for (const line of text.split("\n")) {
        next.changed.push({ at: next.lines.length, group });
        next.lines.push(line);
      }
      l = e.line + 1;
    }
    keep(lines.length);
    entry.new = next;
  }
}

/**
 * The moves a `Mechanical:` commit makes that aren't whole statements: each
 * body moved whole into a new function (cutMovedBodies), each router split
 * (cutMovedProcedures), each stage cut from a function (cutMovedStages)
 * and each UI cut (cutMovedUiParts), and every file's lines at both sides before
 * and after they are cut out. The size ratchet reads these: what is left
 * once they are cut may rise only by its import lines.
 */
export function structuralMoves(
  numstat: FileChange[],
  diff: string,
): {
  bodies: BodyMove[];
  routers: RouterMove[];
  stages: StageMove[];
  ui: UiMove[];
  files: {
    file: string;
    old: string[];
    new: string[];
    oldCut: string[];
    newCut: string[];
  }[];
} {
  const names = renamedNames(numstat);
  const files = readDiff(diff);
  const before = files.map((e) => ({ old: e.old.lines, new: e.new.lines }));
  const bodies = cutMovedBodies(files, names).moves;
  const routers = cutMovedProcedures(files, names).moves;
  const stages = cutMovedStages(files, names).moves;
  const ui = cutMovedUiParts(files, names).moves;
  return {
    bodies,
    routers,
    stages,
    ui,
    files: files.map((e, i) => ({
      file: e.file,
      old: before[i]!.old,
      new: before[i]!.new,
      oldCut: e.old.lines,
      newCut: e.new.lines,
    })),
  };
}

/** A side's code lines (not blank, comment or import), with its statements. */
type CodeSide = {
  file: string;
  /** Code lines in file order; `changed` lines are the ones a move must explain. */
  seq: {
    at: number;
    line: string;
    key: string;
    group: number;
    changed: boolean;
  }[];
  /** Line of each top-level statement's first token, and of its last. */
  startOf: Map<number, number>;
  endOf: Map<number, number>;
};

function readCode(
  file: string,
  side: DiffSide,
  key: (line: string) => string,
): CodeSide {
  const source = ts.createSourceFile(
    file,
    side.lines.join("\n"),
    ts.ScriptTarget.Latest,
  );
  const lineOf = (pos: number) =>
    source.getLineAndCharacterOfPosition(pos).line;
  const importLines = new Set<number>();
  const startOf = new Map<number, number>();
  const endOf = new Map<number, number>();
  source.statements.forEach((statement, index) => {
    const start = lineOf(statement.getStart(source));
    const end = lineOf(statement.getEnd());
    if (!startOf.has(start)) startOf.set(start, index);
    endOf.set(end, index);
    const isImport =
      ts.isImportDeclaration(statement) ||
      ts.isImportEqualsDeclaration(statement) ||
      (ts.isExportDeclaration(statement) &&
        statement.moduleSpecifier !== undefined);
    if (isImport) for (let l = start; l <= end; l++) importLines.add(l);
  });
  const groupAt = new Map(side.changed.map((c) => [c.at, c.group]));
  const seq: CodeSide["seq"] = [];
  side.lines.forEach((line, at) => {
    if (BLANK_LINE.test(line) || COMMENT_LINE.test(line)) return;
    if (importLines.has(at)) return;
    const group = groupAt.get(at);
    seq.push({
      at,
      line,
      key: key(line),
      group: group ?? 0,
      changed: group !== undefined,
    });
  });
  return { file, seq, startOf, endOf };
}

/** The longest in-order matching of `a` and `b` by key, as index pairs. */
function inOrder(a: string[], b: string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  const table: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      table[i]![j] =
        a[i] === b[j]
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) pairs.push([i++, j++]);
    else if (table[i + 1]![j]! >= table[i]![j + 1]!) i++;
    else j++;
  }
  return pairs;
}

/**
 * The code lines a move doesn't explain, the moved runs that aren't whole
 * top-level statements in order, and how many lines moved between files.
 */
function matchCode(code: { old: CodeSide; new: CodeSide }[]): {
  unexplained: Line[];
  broken: Line[];
  movedAcross: number;
} {
  const unexplained: Line[] = [];
  let movedAcross = 0;
  // First each change group's lines in place, in order.
  const matched = code.map(({ old, new: next }) => ({
    old: new Set<number>(),
    new: new Set<number>(),
    oldSide: old,
    newSide: next,
  }));
  for (const m of matched) {
    const groups = new Map<number, { old: number[]; new: number[] }>();
    const add = (side: "old" | "new", seq: CodeSide["seq"]) =>
      seq.forEach((line, i) => {
        if (!line.changed) return;
        const g = groups.get(line.group) ?? { old: [], new: [] };
        g[side].push(i);
        groups.set(line.group, g);
      });
    add("old", m.oldSide.seq);
    add("new", m.newSide.seq);
    for (const g of groups.values()) {
      const pairs = inOrder(
        g.old.map((i) => m.oldSide.seq[i]!.key),
        g.new.map((i) => m.newSide.seq[i]!.key),
      );
      for (const [i, j] of pairs) {
        m.old.add(g.old[i]!);
        m.new.add(g.new[j]!);
      }
    }
  }
  // Then runs moved elsewhere: each run, read in the destination's order,
  // must be the same lines in the same order in its source.
  const open = (f: number, i: number) => {
    const line = matched[f]!.oldSide.seq[i];
    return line !== undefined && line.changed && !matched[f]!.old.has(i);
  };
  const sources = new Map<string, [number, number][]>();
  matched.forEach((m, f) =>
    m.oldSide.seq.forEach((line, i) => {
      if (!open(f, i)) return;
      sources.set(line.key, [...(sources.get(line.key) ?? []), [f, i]]);
    }),
  );
  const broken: Line[] = [];
  const whole = (side: CodeSide, first: number, last: number) => {
    const start = side.startOf.get(side.seq[first]!.at);
    const end = side.endOf.get(side.seq[last]!.at);
    return start !== undefined && end !== undefined && end >= start;
  };
  matched.forEach((m, g) => {
    const seq = m.newSide.seq;
    let j = 0;
    while (j < seq.length) {
      const line = seq[j]!;
      if (!line.changed || m.new.has(j)) {
        j += 1;
        continue;
      }
      let best: { f: number; i: number; length: number } | undefined;
      for (const [f, i] of sources.get(line.key) ?? []) {
        if (!open(f, i)) continue;
        let length = 0;
        while (
          open(f, i + length) &&
          j + length < seq.length &&
          seq[j + length]!.changed &&
          !m.new.has(j + length) &&
          matched[f]!.oldSide.seq[i + length]!.key === seq[j + length]!.key
        )
          length += 1;
        if (!best || length > best.length) best = { f, i, length };
      }
      if (!best) {
        unexplained.push({ file: m.newSide.file, line: seq[j]!.line });
        j += 1;
        continue;
      }
      const from = matched[best.f]!;
      for (let k = 0; k < best.length; k++) {
        from.old.add(best.i + k);
        m.new.add(j + k);
      }
      if (best.f !== g) movedAcross += best.length;
      const last = best.length - 1;
      if (
        !whole(from.oldSide, best.i, best.i + last) ||
        !whole(m.newSide, j, j + last)
      )
        broken.push({ file: m.newSide.file, line: seq[j]!.line });
      j += best.length;
    }
  });
  matched.forEach((m, f) =>
    m.oldSide.seq.forEach((_, i) => {
      if (open(f, i))
        unexplained.push({
          file: m.oldSide.file,
          line: m.oldSide.seq[i]!.line,
        });
    }),
  );

  return { unexplained, broken, movedAcross };
}

/**
 * Why a change isn't a move: `numstat` from `-M --numstat` must show a
 * rename, or code must move between files (a split). `diff` is a full-context
 * diff (`-M -U<large>`), so each file's statements can be read.
 *
 * In a code file every changed line must be an import line (inside an
 * `import` or `export … from` statement), or match a line on the other side
 * that differs from it only in its paths and a leading `export`: in place
 * (the same change group, in order), or as part of a run of whole top-level
 * statements, kept in order, moved within the file or to another one. An
 * arrow or function expression's whole body may move into a new top-level
 * function, its statements compared token by token (cutMovedBodies),
 * whole router procedures into a new part mounted where they were
 * (cutMovedProcedures), a run of a function's top-level statements
 * into a new top-level function, called where they were (cutMovedStages),
 * and an IIFE's body or a JSX run into a new function or component, called
 * or rendered where it was (cutMovedUiParts).
 * A moved statement that gains `export` and is re-wrapped by prettier is
 * compared token by token, at its old layout (unwrapExported). Other
 * lines (docs, data, comments) match by path rewrite as a multiset: first in
 * the same file (a moved entry in a sorted list matches too), then in any
 * other file of the commit. A prettier re-wrap of a file's changed lines
 * passes. A renamed file's bare name counts as a path, and the move's own
 * bookkeeping (MOVE_BOOKKEEPING, AUTO-GEN counts) is left to the checks that
 * guard it.
 */
export function notAMove(
  numstat: FileChange[],
  diff: string,
): string | undefined {
  const renamed = numstat.some((change) => change.file.includes(" => "));
  const names = renamedNames(numstat);
  // Lines no same-file line explains, matched across files once all are read.
  const leftAdded: Line[] = [];
  const leftRemoved: Line[] = [];
  const movedKey = (line: string) =>
    withoutPaths(
      commentPaths(line.replace(/^(\s*)export\s+(?!\{|\*|default\b)/, "$1")),
      names,
    );
  const code: { old: CodeSide; new: CodeSide }[] = [];
  const files = readDiff(diff);
  const cuts = [
    cutMovedBodies(files, names),
    cutMovedProcedures(files, names),
    cutMovedStages(files, names),
    cutMovedUiParts(files, names),
  ];
  const bodiesAcross = cuts.reduce((n, c) => n + c.movedAcross, 0);
  const newFunctions = cuts.reduce((n, c) => n + c.moves.length, 0);
  unwrapExported(files, names);
  // Each file's sides as read, for the comment blocks a move changes.
  const sidesOf = new Map<string, { old: DiffSide; new: DiffSide }>();
  for (const entry of files) {
    const { file, wholeFile } = entry;
    if (MOVE_BOOKKEEPING.test(file)) continue;
    // A file the move creates or deletes brings or takes its comments.
    const kept = (side: DiffSide) =>
      side.changed.filter(({ at }) => {
        const line = side.lines[at]!;
        return (
          !AUTO_GEN_LINE.test(line) && !(wholeFile && COMMENT_LINE.test(line))
        );
      });
    const oldKept = kept(entry.old);
    const newKept = kept(entry.new);
    const removedAll = oldKept.map(({ at }) => entry.old.lines[at]!);
    // Prettier re-wraps a line whose path changed length (a long union gains
    // leading pipes, broken call arguments gain trailing commas): the same
    // text once joined.
    // Only layout goes: prettier's leading union pipe, spaces beside
    // punctuation, a trailing comma. Operators and words stay apart.
    const joined = (lines: string[]) =>
      withoutPaths(lines.join(" "), names)
        .replace(/(^|[=(<,:])\s*\|(?!\|)/g, "$1")
        .replace(/\s*([()[\]{},;:<>=|&?+*/.!-])\s*/g, "$1")
        .replace(/,(?=[)\]}])/g, "");
    // Change group by change group: a line taken out in one place and put
    // back in another is a reorder, not a re-wrap.
    const groups = new Set([...oldKept, ...newKept].map((c) => c.group));
    const sameIn = (g: number) =>
      joined(
        oldKept
          .filter((c) => c.group === g)
          .map(({ at }) => entry.old.lines[at]!),
      ) ===
      joined(
        newKept
          .filter((c) => c.group === g)
          .map(({ at }) => entry.new.lines[at]!),
      );
    if (removedAll.length > 0 && [...groups].every(sameIn)) continue;
    const isCode = CODE_FILE.test(file);
    if (isCode) {
      code.push({
        old: readCode(file, entry.old, movedKey),
        new: readCode(file, entry.new, movedKey),
      });
    }
    // Code lines are matched below; the rest (docs, data, comments) here.
    const text = (side: DiffSide, keptLines: { at: number }[]) =>
      keptLines
        .map(({ at }) => ({ at, line: side.lines[at]! }))
        .filter(({ line }) => !isCode || COMMENT_LINE.test(line));
    const removed = text(entry.old, oldKept);
    const added = text(entry.new, newKept);
    sidesOf.set(file, { old: entry.old, new: entry.new });
    // The register's code-reference cells change with a move; docs:verify
    // checks each still names a real file and function.
    const keyOf = (line: string) =>
      withoutPaths(
        file === REGISTER_DOC
          ? line
              .split("|")
              .map((cell) => (CODE_REF_CELL.test(cell) ? " <refs> " : cell))
              .join("|")
          : commentPaths(line),
        names,
      );
    const pool = new Map<string, number>();
    for (const { line } of removed) {
      const key = keyOf(line);
      pool.set(key, (pool.get(key) ?? 0) + 1);
    }
    for (const { line, at } of added) {
      const key = keyOf(line);
      const left = pool.get(key) ?? 0;
      if (left > 0) pool.set(key, left - 1);
      else if (!IMPORT_LINE.test(line))
        leftAdded.push({ file, line, at, side: "new" });
    }
    for (const { line, at } of removed) {
      const key = keyOf(line);
      const left = pool.get(key) ?? 0;
      if (left === 0) continue;
      pool.set(key, left - 1);
      if (!IMPORT_LINE.test(line))
        leftRemoved.push({ file, line, at, side: "old" });
    }
    // A created or deleted file's comments, matched across files only to
    // hold a split's moved comments to Q3's rule below.
    if (wholeFile && isCode)
      for (const side of ["old", "new"] as const)
        for (const { at } of entry[side].changed) {
          const line = entry[side].lines[at]!;
          if (!COMMENT_LINE.test(line)) continue;
          (side === "old" ? leftRemoved : leftAdded).push({
            file,
            line,
            at,
            side,
            whole: true,
          });
        }
  }
  const matchedCode = matchCode(code);
  let unexplained = matchedCode.unexplained;
  const { broken } = matchedCode;
  let movedAcross = matchedCode.movedAcross + bodiesAcross;

  const moved = new Map<string, Line[]>();
  for (const entry of leftRemoved) {
    const key = movedKey(entry.line);
    moved.set(key, [...(moved.get(key) ?? []), entry]);
  }
  for (const entry of leftAdded) {
    const sourcesOf = moved.get(movedKey(entry.line)) ?? [];
    const i = sourcesOf.findIndex((source) => source.file !== entry.file);
    if (i < 0) {
      unexplained.push(entry);
      continue;
    }
    const [source] = sourcesOf.splice(i, 1);
    // A whole file's comment, taken along, moves no code.
    if (!entry.whole && !source!.whole) movedAcross += 1;
  }
  for (const entries of moved.values()) unexplained.push(...entries);
  if (!renamed && movedAcross === 0)
    return "git sees no rename and no code moved between files";
  // A split takes its doc comments with the code and rewords the old header:
  // comments carry no behavior, and the reviewer still reads them. Owner
  // v0.10.4 Q3: a reworded or new comment stays within RULES' three lines,
  // and each new comment block rewords one the move took away or documents
  // a function it made.
  if (movedAcross > 0) {
    const created = files.filter(
      (f) => f.wholeFile && f.old.lines.length === 0,
    ).length;
    const problem = rewordedComments(
      unexplained,
      sidesOf,
      newFunctions + created,
    );
    if (problem !== undefined) return problem;
    unexplained = unexplained.filter(({ line }) => !COMMENT_LINE.test(line));
  } else unexplained = unexplained.filter(({ whole }) => !whole);
  const first = (lines: Line[]) =>
    lines
      .slice(0, 3)
      .map(({ file: f, line }) => `${f}: ${line.trim()}`)
      .join(" | ");
  if (unexplained.length > 0)
    return `${unexplained.length} changed line(s) are neither imports nor path rewrites (first: ${first(unexplained)})`;
  if (broken.length > 0)
    return `${broken.length} moved run(s) are not whole top-level statements kept in order (first: ${first(broken)})`;
  return undefined;
}

// ---------------------------------------------------------------------------
// Proven renames (owner Q2, v0.10.5): `Mechanical:` with `Rename: a → b, …`
// ---------------------------------------------------------------------------

export const RENAME = "Rename";
const RENAME_PAIR = /^([A-Za-z_$][\w$]*)\s*(?:→|->)\s*([A-Za-z_$][\w$]*)$/;

/** `Rename: a → b, c → d` trailers as one map, and any malformed pair. */
export function readRenames(raw: string): {
  map: Map<string, string>;
  problems: string[];
} {
  const map = new Map<string, string>();
  const problems: string[] = [];
  for (const value of trailerValues(raw, RENAME))
    for (const part of value.split(",").map((s) => s.trim())) {
      const [, from, to] = RENAME_PAIR.exec(part) ?? [];
      if (!from || !to || from === to)
        problems.push(`"${RENAME}: ${part}": write ${RENAME}: <old> → <new>`);
      else if (map.has(from) && map.get(from) !== to)
        problems.push(`${RENAME}: ${from} is renamed twice`);
      else map.set(from, to);
    }
  return { map, problems };
}

/** A leaf token of the tree, kept with its node to read where it stands. */
type Leaf = { node: ts.Node; text: string };

const isName = (n: ts.Node) =>
  n.kind === ts.SyntaxKind.Identifier ||
  n.kind === ts.SyntaxKind.PrivateIdentifier;
const isJsx = (n: ts.Node) =>
  ts.isJsxElement(n) || ts.isJsxFragment(n) || ts.isJsxSelfClosingElement(n);

/**
 * A file's leaf tokens without comments and layout: prettier's re-wrap of a
 * longer name adds or drops a trailing comma, a union's leading `|` or `&`,
 * and the parentheses around multi-line JSX, and nothing else.
 */
function renameLeaves(source: ts.SourceFile): Leaf[] {
  const out: Leaf[] = [];
  const visit = (n: ts.Node) => {
    if (
      n.kind >= ts.SyntaxKind.FirstJSDocNode &&
      n.kind <= ts.SyntaxKind.LastJSDocNode
    )
      return;
    const children = n.getChildren(source);
    if (children.length > 0) {
      const jsxParens = ts.isParenthesizedExpression(n) && isJsx(n.expression);
      for (const c of children)
        if (!(jsxParens && c !== n.expression)) visit(c);
      return;
    }
    if (n.kind === ts.SyntaxKind.EndOfFileToken) return;
    const text =
      n.kind === ts.SyntaxKind.JsxText
        ? jsxTextValue(n.getText(source))
        : n.getText(source);
    if (text !== "") out.push({ node: n, text });
  };
  visit(source);
  return out.filter(
    (leaf, i) =>
      !(leaf.text === "," && CLOSER.has(out[i + 1]?.text ?? "")) &&
      !(
        (leaf.text === "|" || leaf.text === "&") &&
        ["=", "(", "<", ",", ":", "[", undefined].includes(out[i - 1]?.text)
      ),
  );
}

/** Every comment in a file, each line trimmed: a re-indent keeps them. */
function commentTexts(source: ts.SourceFile): string[] {
  const text = source.getFullText();
  const seen = new Set<number>();
  const out: string[] = [];
  const take = (ranges: ts.CommentRange[] | undefined) => {
    for (const r of ranges ?? []) {
      if (seen.has(r.pos)) continue;
      seen.add(r.pos);
      out.push(
        text
          .slice(r.pos, r.end)
          .split("\n")
          .map((l) => l.trim())
          .join("\n"),
      );
    }
  };
  const visit = (n: ts.Node) => {
    const children = n.getChildren(source);
    if (children.length > 0 && !ts.isJSDoc(n)) {
      children.forEach(visit);
      return;
    }
    if (n.kind === ts.SyntaxKind.JsxText || ts.isJSDoc(n)) return;
    take(ts.getTrailingCommentRanges(text, n.pos));
    take(ts.getLeadingCommentRanges(text, n.pos));
  };
  visit(source);
  return out;
}

/** A key a name stands for: a property, a destructured key, a JSX prop. */
function isKey(id: ts.Node): boolean {
  const p = id.parent;
  if (ts.isShorthandPropertyAssignment(p)) return true;
  if (ts.isBindingElement(p))
    return (
      p.propertyName === id ||
      (!p.propertyName && ts.isObjectBindingPattern(p.parent))
    );
  return (
    (ts.isPropertyAssignment(p) ||
      ts.isPropertySignature(p) ||
      ts.isPropertyDeclaration(p) ||
      ts.isMethodDeclaration(p) ||
      ts.isMethodSignature(p) ||
      ts.isGetAccessorDeclaration(p) ||
      ts.isSetAccessorDeclaration(p) ||
      ts.isEnumMember(p) ||
      ts.isJsxAttribute(p) ||
      ts.isPropertyAccessExpression(p)) &&
    p.name === id
  );
}

/** A zod object's schema call: its keys are a parsed shape. */
const ZOD_SHAPE =
  /^z\.(object|strictObject|looseObject)$|\.(extend|safeExtend|pick|omit|partial|required)$/;

/** Why a key renamed at `id` changes a stored, external or response shape. */
function shapeKeyProblem(
  id: ts.Node,
  file: string,
  from: string,
  shapes: { keys: Set<string>; isShapeFile: (file: string) => boolean },
): string | undefined {
  if (!isKey(id)) return undefined;
  if (shapes.keys.has(from))
    return `${from} is a stored, external or response key (scripts/gen-abbreviation-carve-outs.ts reads them)`;
  if (shapes.isShapeFile(file)) return `${file} defines a stored shape`;
  const literalKey =
    ts.isPropertyAssignment(id.parent) ||
    ts.isShorthandPropertyAssignment(id.parent);
  if (!literalKey) return undefined;
  if (file.startsWith("src/server/routers/"))
    return "a router's object key can be its input or output";
  for (let n: ts.Node | undefined = id.parent; n; n = n.parent)
    if (
      ts.isCallExpression(n) &&
      ZOD_SHAPE.test(n.expression.getText()) &&
      n.arguments.some((a) => a.pos <= id.pos && id.end <= a.end)
    )
      return "a z.object key is a parsed shape";
  return undefined;
}

/** Why one code file's change is more than `map` applied to its names. */
function codeRenameProblem(
  file: string,
  oldText: string,
  newText: string,
  map: Map<string, string>,
  shapes: Parameters<typeof shapeKeyProblem>[3],
  used: Set<string>,
): string | undefined {
  const parse = (text: string) =>
    ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const [was, now] = [parse(oldText), parse(newText)];
  const at = (leaf: Leaf | undefined, source: ts.SourceFile) =>
    leaf
      ? `${file}:${source.getLineAndCharacterOfPosition(leaf.node.getStart(source)).line + 1}`
      : `${file} (end)`;
  const [a, b] = [renameLeaves(was), renameLeaves(now)];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const [x, y] = [a[i], b[i]];
    if (x?.text === y?.text) continue;
    if (!x || !y) return `${at(y ?? x, y ? now : was)}: code added or removed`;
    if (!isName(x.node) || !isName(y.node))
      return `${at(y, now)}: "${x.text}" → "${y.text}" changes ${STRING_TOKEN.has(x.node.kind) || x.node.kind === ts.SyntaxKind.JsxText ? "a string" : "code"}, not a name`;
    if (map.get(x.text) !== y.text)
      return `${at(y, now)}: ${x.text} → ${y.text} is not in the ${RENAME}: list`;
    const key = shapeKeyProblem(y.node, file, x.text, shapes);
    if (key) return `${at(y, now)}: ${x.text} as a key: ${key}`;
    used.add(x.text);
  }
  const [c, d] = [commentTexts(was), commentTexts(now)];
  const differs = c.findIndex((t, i) => t !== d[i]);
  if (differs >= 0 || c.length !== d.length)
    return `${file}: a comment changed (a rename changes code only; reword comments in their own commit)`;
  return undefined;
}

/**
 * Why a `Mechanical:` commit with `Rename:` is more than those renames: every
 * changed code line equals its old line once the map is applied to its name
 * tokens (prettier's re-wrap allowed); strings, comments, stored, external
 * and response keys, a router's object keys and z.object keys stay. The
 * register's code references follow the names; the ratchet files keep their
 * own checks. Undefined: proven.
 */
export function notARename(
  numstat: FileChange[],
  diff: string,
  raw: string,
  shapes: Parameters<typeof shapeKeyProblem>[3],
): string | undefined {
  const { map, problems } = readRenames(raw);
  if (problems.length > 0) return problems.join("; ");
  if (numstat.some((c) => c.file.includes(" => ")))
    return `a ${RENAME}: commit moves no file (move it in its own Mechanical: commit)`;
  const used = new Set<string>();
  const words = (line: string) =>
    line.replace(/[A-Za-z_$][\w$]*/g, (w) => {
      const to = map.get(w);
      if (to !== undefined) used.add(w);
      return to ?? w;
    });
  for (const entry of readDiff(diff)) {
    const { file } = entry;
    if (MOVE_BOOKKEEPING.test(file)) continue;
    if (entry.wholeFile)
      return `${file}: a ${RENAME}: commit creates or deletes no file`;
    const [oldText, newText] = [entry.old, entry.new].map((s) =>
      s.lines.join("\n"),
    );
    if (CODE_FILE.test(file)) {
      const problem = codeRenameProblem(
        file,
        oldText!,
        newText!,
        map,
        shapes,
        used,
      );
      if (problem) return problem;
    } else if (file === REGISTER_DOC) {
      const [was, now] = [entry.old, entry.new].map((s) =>
        s.changed.map(({ at }) => s.lines[at]!),
      );
      if (
        was!.length !== now!.length ||
        was!.some((l, i) => words(l) !== now![i])
      )
        return `${file}: a changed line is more than the renamed names`;
    } else
      return `${file}: a ${RENAME}: commit changes code and the register only`;
  }
  const unused = [...map.keys()].filter((k) => !used.has(k));
  if (unused.length > 0)
    return `${RENAME}: ${unused.join(", ")} renamed nowhere in this commit`;
  return undefined;
}

/** Why a `Mechanical:` commit isn't one: a proven rename, else a move. */
export function mechanicalProblem(
  raw: string,
  numstat: FileChange[],
  diff: string,
): string | undefined {
  if (trailerValues(raw, RENAME).length === 0) return notAMove(numstat, diff);
  return notARename(numstat, diff, raw, {
    keys: storedAndResponseKeys(),
    isShapeFile,
  });
}

export function checkCommit(facts: CommitFacts): Warning[] {
  const { message, files } = facts;
  const warnings: Warning[] = [];
  const claimed = "Mechanical" in message.trailers;
  const mechanical = claimed && facts.notMechanical === undefined;
  if (claimed && facts.notMechanical !== undefined) {
    warnings.push({
      rule: "mechanical",
      text: `Mechanical: is for a move or rename only: ${facts.notMechanical}`,
    });
  }

  if (!SUBJECT_PREFIX.test(message.subject)) {
    warnings.push({
      rule: "prefix",
      text: `subject has no type prefix (fix:, feat:, refactor:, docs:, test:, chore:, …): "${message.subject}"`,
    });
  }
  if (message.body.length === 0 && !mechanical) {
    warnings.push({ rule: "why", text: "no body: say why the change is made" });
  }
  if (
    isRevertSubject(message.subject) &&
    message.body.length > 0 &&
    revertReason(message) === ""
  ) {
    warnings.push({
      rule: "revert-reason",
      text: 'a revert says why: "This reverts commit …" alone gives no reason',
    });
  }
  const srcLines = srcLinesChanged(files);
  if (srcLines > MAX_SRC_LINES && !mechanical) {
    warnings.push({
      rule: "size",
      text: `${srcLines} changed src/ lines (limit ${MAX_SRC_LINES}); split it, or add a Mechanical: trailer to a pure move or rename`,
    });
  }
  const srcFiles = srcFileCount(files);
  if (touchesEngineOrTax(files) && srcFiles > MAX_ENGINE_FILES && !mechanical) {
    warnings.push({
      rule: "engine-files",
      text: `engine or tax commit touches ${srcFiles} src/ files (limit ${MAX_ENGINE_FILES})`,
    });
  }
  if (looksLikeFix(message.subject)) {
    const repeated = [...facts.priorFixes].filter(([, count]) => count > 0);
    const third = repeated.filter(([, count]) => count >= 2);
    if (repeated.length > 0 && !("Concept" in message.trailers)) {
      warnings.push({
        rule: "second-fix",
        text: `second fix within ${FIX_WINDOW_DAYS} days in ${repeated.map(([spot]) => spot).join(", ")}: add "Concept: <the missing concept>" or "Concept: none, <reason>"`,
      });
    }
    if (third.length > 0 && !/^PASS\b/.test(message.trailers.Advisor ?? "")) {
      warnings.push({
        rule: "third-fix",
        text: `third fix within ${FIX_WINDOW_DAYS} days in ${third.map(([spot]) => spot).join(", ")}: take it to the advisor first, and record its pass in "Advisor: PASS (round <n>)"`,
      });
    }
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// git
// ---------------------------------------------------------------------------

export type Git = (...args: string[]) => string;

/** git in `cwd` (default: this process's directory). */
export const gitIn =
  (cwd?: string): Git =>
  (...args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });

const git = gitIn();

type HistoryCommit = {
  sha: string;
  time: number;
  subject: string;
  spots: Spot[];
};

/** Every non-merge commit since `sinceSeconds`, with the functions it touched in `src/`. */
export function readHistory(sinceSeconds: number): HistoryCommit[] {
  const out = git(
    "log",
    "--no-merges",
    `--since=${sinceSeconds}`,
    "--format=%x00%H%x1f%ct%x1f%s",
    "-U0",
    "-p",
    "--",
    "src/",
  );
  return out
    .split("\x00")
    .filter(Boolean)
    .map((chunk) => {
      const newline = chunk.indexOf("\n");
      const header = newline === -1 ? chunk : chunk.slice(0, newline);
      const [sha = "", time = "0", subject = ""] = header.split("\x1f");
      return {
        sha,
        time: Number(time),
        subject,
        spots: spotsFromDiff(newline === -1 ? "" : chunk.slice(newline + 1)),
      };
    });
}

/** How many fix commits before `time` (within the window) touched each spot. */
export function countPriorFixes(
  spots: Spot[],
  time: number,
  history: HistoryCommit[],
  excludeSha?: string,
): Map<Spot, number> {
  const counts = new Map<Spot, number>();
  for (const spot of spots) counts.set(spot, 0);
  for (const commit of history) {
    if (commit.sha === excludeSha) continue;
    if (
      commit.time >= time ||
      commit.time < time - FIX_WINDOW_DAYS * DAY_SECONDS
    )
      continue;
    if (!looksLikeFix(commit.subject)) continue;
    for (const spot of commit.spots) {
      if (counts.has(spot)) counts.set(spot, (counts.get(spot) ?? 0) + 1);
    }
  }
  return counts;
}

function factsForCommit(sha: string, history: HistoryCommit[]): CommitFacts {
  const message = parseMessage(git("log", "-1", "--format=%B", sha));
  const notMechanical =
    "Mechanical" in message.trailers
      ? mechanicalProblem(
          git("log", "-1", "--format=%B", sha),
          parseNumstat(git("show", "-M", "--numstat", "--format=", sha)),
          git("show", "-M", FULL_CONTEXT, "--format=", sha),
        )
      : undefined;
  const files = parseNumstat(git("show", "--numstat", "--format=", sha));
  const spots = spotsFromDiff(
    git("show", "-U0", "--format=", sha, "--", "src/"),
  );
  const time = Number(git("log", "-1", "--format=%ct", sha).trim());
  return {
    message,
    files,
    spots,
    priorFixes: countPriorFixes(spots, time, history, sha),
    notMechanical,
  };
}

function report(label: string, warnings: Warning[]) {
  for (const warning of warnings) {
    console.warn(`warning: ${label}: ${warning.text}`);
  }
}

function runMessageFile(file: string): Warning[] {
  const message = parseMessage(readFileSync(file, "utf8"));
  if (message.subject.startsWith("Merge ")) return [];
  const files = parseNumstat(git("diff", "--cached", "--numstat"));
  const spots = spotsFromDiff(git("diff", "--cached", "-U0", "--", "src/"));
  const now = Math.floor(Date.now() / 1000);
  const history = readHistory(now - FIX_WINDOW_DAYS * DAY_SECONDS);
  const notMechanical =
    "Mechanical" in message.trailers
      ? mechanicalProblem(
          readFileSync(file, "utf8"),
          parseNumstat(git("diff", "--cached", "-M", "--numstat")),
          git("diff", "--cached", "-M", FULL_CONTEXT),
        )
      : undefined;
  const warnings = checkCommit({
    message,
    files,
    spots,
    priorFixes: countPriorFixes(spots, now + 1, history),
    notMechanical,
  });
  report("commit", warnings);
  return warnings;
}

/** The non-merge commits in `range`, oldest first. */
export function commitsIn(range: string, run: Git = git): string[] {
  return run("rev-list", "--no-merges", "--reverse", range)
    .split("\n")
    .filter(Boolean);
}

function runShas(shas: string[], summary: boolean): Warning[] {
  const first = shas[0];
  if (first === undefined) return [];
  const oldest = Number(git("log", "-1", "--format=%ct", first).trim());
  const history = readHistory(oldest - FIX_WINDOW_DAYS * DAY_SECONDS);
  const all: Warning[] = [];
  const tally = {
    prefix: 0,
    why: 0,
    size: 0,
    engineFiles: 0,
    fixes: 0,
    second: 0,
    third: 0,
  };
  for (const sha of shas) {
    const facts = factsForCommit(sha, history);
    const warnings = checkCommit(facts);
    report(`${sha.slice(0, 8)} ${facts.message.subject}`, warnings);
    all.push(...warnings);
    const has = (rule: string) =>
      warnings.some((warning) => warning.rule === rule);
    if (!has("prefix")) tally.prefix += 1;
    if (!has("why")) tally.why += 1;
    if (!has("size")) tally.size += 1;
    if (!has("engine-files")) tally.engineFiles += 1;
    if (looksLikeFix(facts.message.subject)) tally.fixes += 1;
    if ([...facts.priorFixes.values()].some((count) => count >= 1)) {
      if (looksLikeFix(facts.message.subject)) tally.second += 1;
    }
    if (has("third-fix")) tally.third += 1;
  }
  if (summary) {
    const n = shas.length;
    console.log(`${n} commits (merges skipped):`);
    console.log(`  type prefix:            ${tally.prefix} of ${n}`);
    console.log(`  body says why:          ${tally.why} of ${n}`);
    console.log(`  within ${MAX_SRC_LINES} src/ lines:  ${tally.size} of ${n}`);
    console.log(
      `  engine/tax ≤ ${MAX_ENGINE_FILES} files:   ${tally.engineFiles} of ${n}`,
    );
    console.log(`  fixes (subject says fix): ${tally.fixes}`);
    console.log(
      `  repeat fix in one spot within ${FIX_WINDOW_DAYS} days: ${tally.second} (of them, third or more: ${tally.third})`,
    );
  }
  return all;
}

function main() {
  const args = process.argv.slice(2);
  const strict = args.includes("--strict");
  const value = (flag: string) => {
    const index = args.indexOf(flag);
    return index === -1 ? undefined : args[index + 1];
  };
  let warnings: Warning[];
  const messageFile = value("--message-file");
  const range = value("--range");
  const historyCount = value("--history");
  if (messageFile) {
    warnings = runMessageFile(messageFile);
  } else if (range) {
    warnings = runShas(commitsIn(range), true);
  } else if (historyCount) {
    const shas = git(
      "rev-list",
      "--no-merges",
      `--max-count=${historyCount}`,
      "HEAD",
    )
      .split("\n")
      .filter(Boolean)
      .reverse();
    warnings = runShas(shas, true);
  } else {
    console.error(
      "usage: check-commit.ts --message-file <file> | --range <a..b> | --history <n> [--strict]",
    );
    process.exit(2);
  }
  if (warnings.length > 0) {
    console.warn(
      `${warnings.length} commit-rule warning(s); see CONTRIBUTING.md § Commit rules.${strict ? "" : " Report only (no --strict)."}`,
    );
  }
  process.exit(strict && warnings.length > 0 ? 1 : 0);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
