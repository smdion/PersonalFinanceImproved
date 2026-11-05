/**
 * Ratchets and the behavior baseline, checked against the merge base (CI
 * blocks on it). Each ratchet file is compared with its copy at `--base`, so
 * a commit can't loosen the rule it is checked by:
 *
 *   size-baseline.json, eslint-suppressions.json, eslint-suppressions-typed.json,
 *   scripts/calculation-register-baseline.json (lists and risk labels),
 *   the page budgets in scripts/check-bundle-size.ts, the coverage thresholds
 *   and excludes in vitest.config.ts, the known lists in
 *   tests/lint/violations.test.ts and tests/baseline/router-baseline-postgres.test.ts,
 *   and tests/baseline/__baseline__/** and __sync__/** (only deletions pass).
 *
 * A move or split is a redistribution, not a rise: each added file is matched
 * to the file its lines came from, and the counts of the files so joined are
 * summed against their old entries. A raise passes only when a commit in
 * base..head that changes the file carries `Ratchet-raise: <file> — <reason>`;
 * a re-recorded baseline file needs `Baseline-rerecord: <glob> — <reason>`.
 *
 *   tsx scripts/check-ratchets.ts --base "$(git merge-base origin/main HEAD)" [--head <ref>]
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  REGISTER_FILE,
  SIZE_FILE,
  SUPPRESSION_FILES,
  registerRises,
  sizeRises,
  suppressionRises,
  type Register,
  type SizeBaseline,
} from "./ratchets/counts";
import {
  BUNDLE_FILE,
  COVERAGE_FILE,
  LIST_FILES,
  bundleRises,
  coverageRises,
  listRises,
} from "./ratchets/code-limits";
import {
  commitsIn,
  gitIn,
  parseNumstat,
  trailerValues,
  type Git,
} from "./check-commit";
import { attributeMoves, groupsOf, parseDiff } from "./ratchets/moves";
import type { Rise, Tree } from "./ratchets/rise";

export const BASELINE_DIRS = [
  "tests/baseline/__baseline__",
  "tests/baseline/__sync__",
];

// ---------------------------------------------------------------------------
// Trailers
// ---------------------------------------------------------------------------

export type Commit = { sha: string; message: string; files: string[] };
export const RAISE = "Ratchet-raise";
export const RERECORD = "Baseline-rerecord";

/** `Key: a, b — reason` lines; a line with no reason is reported. */
export function trailerScopes(
  message: string,
  key: string,
): { scopes: string[]; problems: string[] } {
  const scopes: string[] = [];
  const problems: string[] = [];
  for (const value of trailerValues(message, key)) {
    const match = /^(.+?)\s+(?:—|--)\s+(\S.*)$/.exec(value);
    if (!match) {
      problems.push(`"${key}: ${value}": write ${key}: <file> — <reason>`);
      continue;
    }
    scopes.push(
      ...match[1]!
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }
  return { scopes, problems };
}

/** Whether a commit that changes `file` names it in a `key:` trailer. */
function allowedBy(
  commits: Commit[],
  key: string,
  file: string,
  matches: (scope: string, file: string) => boolean,
): boolean {
  return commits.some(
    (c) =>
      c.files.includes(file) &&
      trailerScopes(c.message, key).scopes.some((s) => matches(s, file)),
  );
}

const globMatch = (scope: string, file: string) =>
  scope === file ||
  path.matchesGlob(file, scope) ||
  path.matchesGlob(path.relative("tests/baseline", file), scope);

/** Baseline files added or changed (deletions pass), not re-recorded by trailer. */
export function baselineRises(changed: string[], commits: Commit[]): Rise[] {
  return changed
    .filter((file) => !allowedBy(commits, RERECORD, file, globMatch))
    .map((file) => ({
      file,
      text: `${file}: behavior baseline changed (only a deletion passes; a re-record carries ${RERECORD}: <glob> — <reason>)`,
    }));
}

/** The rises no commit's `Ratchet-raise:` trailer names. */
export function unexcused(rises: Rise[], commits: Commit[]): Rise[] {
  return rises.filter(
    (rise) => !allowedBy(commits, RAISE, rise.file, (s, f) => s === f),
  );
}

// ---------------------------------------------------------------------------
// git
// ---------------------------------------------------------------------------

const treeAt =
  (git: Git, ref: string): Tree =>
  (file) => {
    try {
      return git("show", `${ref}:${file}`);
    } catch {
      return undefined;
    }
  };

/** Each non-merge commit in base..head with its message and changed files. */
function commitsWithFiles(git: Git, base: string, head: string): Commit[] {
  return commitsIn(`${base}..${head}`, git).map((sha) => ({
    sha,
    message: git("log", "-1", "--format=%B", sha),
    files: parseNumstat(
      git("show", "--numstat", "--no-renames", "--format=", sha),
    ).map((change) => change.file),
  }));
}

function renamesIn(git: Git, base: string, head: string): Map<string, string> {
  const renames = new Map<string, string>();
  for (const line of git("diff", "-M", "--name-status", base, head).split(
    "\n",
  )) {
    const [status = "", from, to] = line.split("\t");
    if (status.startsWith("R") && from && to) renames.set(to, from);
  }
  return renames;
}

export function checkRatchets(
  base: string,
  head: string,
  cwd = process.cwd(),
): string[] {
  const git = gitIn(cwd);
  const was = treeAt(git, base);
  const now = treeAt(git, head);
  const commits = commitsWithFiles(git, base, head);
  const diffs = parseDiff(git("diff", "--no-renames", "-U0", base, head));
  const moves = attributeMoves(diffs, renamesIn(git, base, head));
  const group = groupsOf(moves);
  const json = <T>(tree: Tree, file: string, empty: T): T => {
    const text = tree(file);
    return text === undefined ? empty : (JSON.parse(text) as T);
  };
  const rises: Rise[] = [];
  const both = (file: string) => [was(file) ?? "", now(file) ?? ""] as const;

  const emptySize: SizeBaseline = { files: {}, functions: {} };
  rises.push(
    ...sizeRises(
      json(was, SIZE_FILE, emptySize),
      json(now, SIZE_FILE, emptySize),
      group,
    ),
  );
  for (const file of SUPPRESSION_FILES)
    rises.push(
      ...suppressionRises(
        file,
        json(was, file, {}),
        json(now, file, {}),
        group,
      ),
    );
  const emptyRegister: Register = {
    risk: {},
    highRiskWithoutIndependentTest: [],
    exportsWithoutRow: [],
  };
  rises.push(
    ...registerRises(
      json(was, REGISTER_FILE, emptyRegister),
      json(now, REGISTER_FILE, emptyRegister),
    ),
  );
  rises.push(...bundleRises(...both(BUNDLE_FILE), now));
  rises.push(...coverageRises(...both(COVERAGE_FILE), moves));
  for (const file of LIST_FILES)
    rises.push(...listRises(file, ...both(file), moves));

  const changed = git(
    "diff",
    "--no-renames",
    "--diff-filter=AMTC",
    "--name-only",
    base,
    head,
    "--",
    ...BASELINE_DIRS,
  )
    .split("\n")
    .filter(Boolean);

  const problems = commits.flatMap((c) =>
    [RAISE, RERECORD].flatMap((key) =>
      trailerScopes(c.message, key).problems.map(
        (p) => `${c.sha.slice(0, 8)}: ${p}`,
      ),
    ),
  );
  return [
    ...problems,
    ...unexcused(rises, commits).map(
      (r) =>
        `${r.file}: ${r.text} — a raise (owner's OK only) carries "${RAISE}: ${r.file} — <reason>"`,
    ),
    ...baselineRises(changed, commits).map((r) => r.text),
  ];
}

function main(argv: string[]): number {
  const value = (flag: string) => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  const base = value("--base");
  const head = value("--head") ?? "HEAD";
  if (!base) {
    console.error(
      'usage: check-ratchets.ts --base "$(git merge-base origin/main HEAD)" [--head <ref>]',
    );
    return 2;
  }
  if (process.env.LEDGR_BASELINE_WRITE) {
    console.error(
      "LEDGR_BASELINE_WRITE is set: the baseline tests would rewrite what they check.",
    );
    return 1;
  }
  const failures = checkRatchets(base, head);
  for (const line of failures) console.error(line);
  if (failures.length > 0) {
    console.error(
      `\n${failures.length} ratchet failure(s) against ${base.slice(0, 12)}; see docs/RULES.md § Refactoring.`,
    );
    return 1;
  }
  console.log(
    `Ratchets: nothing rose and no baseline file changed since ${base.slice(0, 12)}.`,
  );
  return 0;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  process.exitCode = main(process.argv.slice(2));
