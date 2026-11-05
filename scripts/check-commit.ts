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
 * an import or a path rewrite), and the
 * second-fix rule: a fix to a function that already had a fix in the last 30
 * days names the missing concept in a `Concept:` trailer; a third goes to the
 * advisor first. A revert says why in its own words: git's "This reverts
 * commit …" line alone isn't a reason.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

/** A line a move may change freely: an import, an export-from, a name in
 *  an import list, or punctuation. */
const IMPORT_LINE =
  /^\s*(import\b|export\b.*\bfrom\b|\}\s*from\b|(type\s+)?[\w$]+(\s+as\s+[\w$]+)?,?\s*$|[{}();,\s]*$)/;
/** A path-like token: anything with a slash in it. */
const PATH_TOKEN = /[\w@.~$[\]()-]*\/[\w@.~$[\]()/-]*/g;
/**
 * Files a move rewrites as its own record, each guarded by its own check
 * (check:ratchets, check:layers and its trailers, check:calculation-register,
 * check:engine-hash), so the move check doesn't read them line by line.
 */
const MOVE_BOOKKEEPING =
  /^(size-baseline\.json|eslint-suppressions(-typed)?\.json|\.dependency-cruiser-known-violations\.json|scripts\/calculation-register-baseline\.json|src\/lib\/generated\/.*)$/;
/** A comment line: a line comment, or a line of a block comment. */
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*\/|\*(\s|$))/;
/** The calculation register, whose code-reference cells docs:verify checks. */
const REGISTER_DOC = "docs/CALCULATIONS.md";
/** A table cell naming code: a backticked `file.ts` or `file.ts:name`. */
const CODE_REF_CELL = /`[^`|]*\.tsx?(:[^`|]*)?`/;
/** A changed line and its file. */
type Line = { file: string; line: string };
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

/**
 * Why a change isn't a move: `numstat` from `-M --numstat` must show a
 * rename, or code must move between files (a split). In `diff` (`-M -U0`)
 * every removed or added line must be an import line, or match a line on
 * the other side that differs from it only in its paths: first in the same
 * file (a moved entry in a sorted list matches too), then in any other file
 * of the commit, where a leading `export` may be added or dropped (a split
 * exports what its parts share). A renamed file's bare name counts as a
 * path, and the move's own bookkeeping (MOVE_BOOKKEEPING, AUTO-GEN counts)
 * is left to the checks that guard it.
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
  let file = "";
  let removed: string[] = [];
  let added: string[] = [];
  const settle = () => {
    if (MOVE_BOOKKEEPING.test(file)) {
      removed = [];
      added = [];
      return;
    }
    removed = removed.filter((line) => !AUTO_GEN_LINE.test(line));
    added = added.filter((line) => !AUTO_GEN_LINE.test(line));
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
    if (removed.length > 0 && joined(removed) === joined(added)) {
      removed = [];
      added = [];
      return;
    }
    // The register's code-reference cells change with a move; docs:verify
    // checks each still names a real file and function.
    const keyOf = (line: string) =>
      withoutPaths(
        file === REGISTER_DOC
          ? line
              .split("|")
              .map((cell) => (CODE_REF_CELL.test(cell) ? " <refs> " : cell))
              .join("|")
          : line,
        names,
      );
    const pool = new Map<string, number>();
    for (const line of removed) {
      const key = keyOf(line);
      pool.set(key, (pool.get(key) ?? 0) + 1);
    }
    for (const line of added) {
      const key = keyOf(line);
      const left = pool.get(key) ?? 0;
      if (left > 0) pool.set(key, left - 1);
      else if (!IMPORT_LINE.test(line)) leftAdded.push({ file, line });
    }
    for (const line of removed) {
      const key = keyOf(line);
      const left = pool.get(key) ?? 0;
      if (left === 0) continue;
      pool.set(key, left - 1);
      if (!IMPORT_LINE.test(line)) leftRemoved.push({ file, line });
    }
    removed = [];
    added = [];
  };
  let header = false;
  let wholeFile = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      settle();
      header = true;
      wholeFile = false;
    } else if (header && /^(new|deleted) file mode /.test(line)) {
      wholeFile = true;
    } else if (line.startsWith("@@")) {
      header = false;
    } else if (header) {
      if (line.startsWith("+++ ")) file = line.replace(/^\+\+\+ (b\/)?/, "");
    } else if (wholeFile && COMMENT_LINE.test(line.slice(1))) {
      // A file the move creates or deletes brings or takes its comments.
    } else if (line.startsWith("-")) removed.push(line.slice(1));
    else if (line.startsWith("+")) added.push(line.slice(1));
  }
  settle();
  const movedKey = (line: string) =>
    withoutPaths(
      line.replace(/^(\s*)export\s+(?!\{|\*|default\b)/, "$1"),
      names,
    );
  const moved = new Map<string, Line[]>();
  for (const entry of leftRemoved) {
    const key = movedKey(entry.line);
    moved.set(key, [...(moved.get(key) ?? []), entry]);
  }
  let unexplained: Line[] = [];
  let movedAcross = 0;
  for (const entry of leftAdded) {
    const sources = moved.get(movedKey(entry.line)) ?? [];
    const i = sources.findIndex((source) => source.file !== entry.file);
    if (i < 0) {
      unexplained.push(entry);
      continue;
    }
    sources.splice(i, 1);
    movedAcross += 1;
  }
  for (const entries of moved.values()) unexplained.push(...entries);
  if (!renamed && movedAcross === 0)
    return "git sees no rename and no code moved between files";
  // A split takes its doc comments with the code and rewords the old file's
  // header: comments carry no behavior, and the reviewer still reads them.
  if (movedAcross > 0)
    unexplained = unexplained.filter(({ line }) => !COMMENT_LINE.test(line));
  if (unexplained.length === 0) return undefined;
  const first = unexplained
    .slice(0, 3)
    .map(({ file: f, line }) => `${f}: ${line.trim()}`);
  return `${unexplained.length} changed line(s) are neither imports nor path rewrites (first: ${first.join(" | ")})`;
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
    if (third.length > 0) {
      warnings.push({
        rule: "third-fix",
        text: `third fix within ${FIX_WINDOW_DAYS} days in ${third.map(([spot]) => spot).join(", ")}: take it to the advisor first`,
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
      ? notAMove(
          parseNumstat(git("show", "-M", "--numstat", "--format=", sha)),
          git("show", "-M", "-U0", "--format=", sha),
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
      ? notAMove(
          parseNumstat(git("diff", "--cached", "-M", "--numstat")),
          git("diff", "--cached", "-M", "-U0"),
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
