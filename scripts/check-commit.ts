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
 * touched (a `Mechanical:` trailer exempts a pure move or rename: git sees
 * a rename, and every other changed line is an import or a path rewrite), and the
 * second-fix rule: a fix to a function that already had a fix in the last 30
 * days names the missing concept in a `Concept:` trailer; a third goes to the
 * advisor first.
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
/**
 * Engine and tax code, where a commit may touch at most 8 `src/` files.
 * `lib/calculators/` holds engine and tax code until it moves to `lib/pure/`.
 */
const ENGINE_OR_TAX = [
  /^src\/lib\/pure\/(engine|tax)\//,
  /^src\/lib\/calculators\//,
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
/** A line with its paths, spacing, table padding and trailing comma gone. */
const withoutPaths = (line: string) =>
  line
    .replace(PATH_TOKEN, "<path>")
    .replace(/\s+/g, " ")
    .replace(/ ?\| ?/g, "|")
    .replace(/-{3,}/g, "---")
    .trim()
    .replace(/,$/, "");

/**
 * Why a change isn't a move: `numstat` from `-M --numstat` must show a
 * rename, and in `diff` (`-M -U0`) every removed or added line of a file
 * must be an import line, or match a line on the other side of the same
 * file that differs from it only in its paths (a moved entry in a sorted
 * list matches too).
 */
export function notAMove(
  numstat: FileChange[],
  diff: string,
): string | undefined {
  if (!numstat.some((change) => change.file.includes(" => ")))
    return "git sees no rename";
  const bad: string[] = [];
  let file = "";
  let removed: string[] = [];
  let added: string[] = [];
  const settle = () => {
    const pool = new Map<string, number>();
    for (const line of removed) {
      const key = withoutPaths(line);
      pool.set(key, (pool.get(key) ?? 0) + 1);
    }
    for (const line of added) {
      const key = withoutPaths(line);
      const left = pool.get(key) ?? 0;
      if (left > 0) pool.set(key, left - 1);
      else if (!IMPORT_LINE.test(line)) bad.push(`${file}: ${line.trim()}`);
    }
    for (const line of removed) {
      const key = withoutPaths(line);
      const left = pool.get(key) ?? 0;
      if (left === 0) continue;
      pool.set(key, left - 1);
      if (!IMPORT_LINE.test(line)) bad.push(`${file}: ${line.trim()}`);
    }
    removed = [];
    added = [];
  };
  let header = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      settle();
      header = true;
    } else if (line.startsWith("@@")) {
      header = false;
    } else if (header) {
      if (line.startsWith("+++ ")) file = line.replace(/^\+\+\+ (b\/)?/, "");
    } else if (line.startsWith("-")) removed.push(line.slice(1));
    else if (line.startsWith("+")) added.push(line.slice(1));
  }
  settle();
  if (bad.length === 0) return undefined;
  return `${bad.length} changed line(s) are neither imports nor path rewrites (first: ${bad.slice(0, 3).join(" | ")})`;
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
