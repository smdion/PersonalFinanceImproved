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
 * summed against their old entries. Ratchets are compared commit by commit,
 * each with its parent: a rise passes only when that commit carries a
 * `Ratchet-raise:` trailer naming the entry and at least its rise
 * (scripts/ratchets/raise.ts has the format), or the commit reverts the one
 * that lowered it. In a `Mechanical:` commit a size entry rises by exactly
 * the import lines the commit adds to the files it joins, or (owner Q14) by
 * those plus a body moved whole's signature, brace and call, or a router
 * split's part wrapper and mount: once check-commit's moves are cut out,
 * the code lines left rise by exactly the import lines. Every excused rise
 * is printed. A re-recorded baseline file needs
 * `Baseline-rerecord: <glob> — <reason>` from a commit that changes it.
 * A known-list entry whose key changes and nothing else is excused by that
 * commit's `Known-renamed:` trailer (scripts/ratchets/known-renamed.ts).
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
  listEntries,
  listRises,
} from "./ratchets/code-limits";
import {
  commitsIn,
  gitIn,
  parseNumstat,
  structuralMoves,
  trailerValues,
  type Git,
} from "./check-commit";
import { functionEntries } from "./check-size-baseline";
import { attributeMoves, groupsOf, parseDiff } from "./ratchets/moves";
import { RAISE, excuse, importLines } from "./ratchets/raise";
import {
  KNOWN_RENAMED,
  knownRenamed,
  readKnownRenamed,
  type KnownRename,
} from "./ratchets/known-renamed";
import type { Rise, Tree } from "./ratchets/rise";

export { RAISE };

export const BASELINE_DIRS = [
  "tests/baseline/__baseline__",
  "tests/baseline/__sync__",
];

// ---------------------------------------------------------------------------
// Trailers
// ---------------------------------------------------------------------------

export type Commit = { sha: string; message: string; files: string[] };
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
      const form =
        key === RAISE ? "<file> — <entry> +<N>, <reason>" : "<glob> — <reason>";
      problems.push(`"${key}: ${value}": write ${key}: ${form}`);
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
      id: file,
      entry: { paths: [file], names: [] },
      text: `${file}: behavior baseline changed (only a deletion passes; a re-record carries ${RERECORD}: <glob> — <reason>)`,
    }));
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

function renamesIn(git: Git, from: string, to: string): Map<string, string> {
  const renames = new Map<string, string>();
  for (const line of git("diff", "-M", "--name-status", from, to).split("\n")) {
    const [status = "", old, now] = line.split("\t");
    if (status.startsWith("R") && old && now) renames.set(now, old);
  }
  return renames;
}

export const RATCHET_FILES = [
  SIZE_FILE,
  ...SUPPRESSION_FILES,
  REGISTER_FILE,
  BUNDLE_FILE,
  COVERAGE_FILE,
  ...LIST_FILES,
];

/** Every ratchet that rose from `from` to `to`, moves and splits counted. */
export function risesBetween(git: Git, from: string, to: string): Rise[] {
  const was = treeAt(git, from);
  const now = treeAt(git, to);
  const diffs = parseDiff(git("diff", "--no-renames", "-U0", from, to));
  const moves = attributeMoves(diffs, renamesIn(git, from, to));
  const group = groupsOf(moves);
  const json = <T>(tree: Tree, file: string, empty: T): T => {
    const text = tree(file);
    return text === undefined ? empty : (JSON.parse(text) as T);
  };
  const rises: Rise[] = [];
  const both = (file: string) => [was(file) ?? "", now(file) ?? ""] as const;

  const emptySize: SizeBaseline = { files: {}, functions: {} };
  const changed = [...diffs.keys()];
  for (const rise of sizeRises(
    json(was, SIZE_FILE, emptySize),
    json(now, SIZE_FILE, emptySize),
    group,
  )) {
    const g = group((rise.sized ?? rise.entry.paths)[0] ?? "");
    const joined = new Set([...(rise.sized ?? rise.entry.paths), ...changed]);
    rises.push({ ...rise, joined: [...joined].filter((f) => group(f) === g) });
  }
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
  return rises;
}

/**
 * The rises a merge makes itself: an entry that rose against every parent.
 * What one parent brings in was checked in its own commits (or is the base's).
 */
function mergeRises(git: Git, sha: string): Rise[] {
  const parents = git("log", "-1", "--format=%P", sha).trim().split(" ");
  const sides = parents.map((p) => risesBetween(git, p, sha));
  const [first = [], ...rest] = sides;
  return first.flatMap((rise) => {
    const others = rest.map((side) => side.find((r) => r.id === rise.id));
    if (others.some((r) => r === undefined)) return [];
    const by = [rise, ...others].map((r) => r!.by);
    return [
      {
        ...rise,
        by: by.every((n) => n !== undefined) ? Math.min(...by) : undefined,
      },
    ];
  });
}

const short = (sha: string) => sha.slice(0, 8);
const plus = (rise: Rise) => (rise.by === undefined ? "" : ` (+${rise.by})`);

/**
 * In a `Mechanical:` commit an excused size rise is exactly the import lines
 * the commit adds to the files it joins, net across them; a function's entry
 * exactly the lines its `import("…")` types grow by. Else the moves of
 * structuralLines may explain it.
 */
function notImportLines(
  git: Git,
  sha: string,
  rise: Rise,
  moves: () => Moves,
): string | undefined {
  if (rise.file !== SIZE_FILE) return undefined;
  const plain = importLinesOnly(git, sha, rise);
  if (plain === undefined) return undefined;
  const structural = structuralLines(git, sha, rise, moves());
  if (structural === undefined) return undefined;
  return structural === "" ? plain : `${plain}; ${structural}`;
}

type Moves = ReturnType<typeof structuralMoves>;

/** A Mechanical commit's moved bodies and router splits (check-commit's own reading). */
function movesOf(git: Git, sha: string): Moves {
  return structuralMoves(
    parseNumstat(git("show", "-M", "--numstat", "--format=", sha)),
    git("show", "-M", "-U1000000", "--format=", sha),
  );
}

const codeLines = (lines: string[]) =>
  lines.filter((l) => !/^\s*$/.test(l)).length;

/**
 * Owner Q14: a procedure body moved whole into a service function may raise
 * size entries by its import lines plus its signature, closing brace and the
 * router's one-line call; a router split (plan 42) by its imports plus the
 * new part's `export const … = createTRPCRouter({` / `});` and its one mount.
 * check-commit's own reading finds those moves (structuralMoves). Once they
 * are cut out of the joined files, what is left may rise by exactly its
 * import lines, counted in code lines (blank lines are layout); the moved
 * code itself may not grow. A function entry the moved body takes over
 * (`xRouter.summary.query()` → `computeX`, and the functions inside it)
 * may grow by the lines its signature and brace add over the router's
 * arrow, and nothing else. Returns undefined when that explains the rise,
 * "" when no such move joins these files, else why not.
 */
function structuralLines(
  git: Git,
  sha: string,
  rise: Rise,
  moves: Moves,
): string | undefined {
  const joined = new Set(rise.joined ?? []);
  const inside = (m: { from: string; to: string }) =>
    joined.has(m.from) && joined.has(m.to);
  const bodies = moves.bodies.filter(inside);
  const routers = moves.routers.filter(inside);
  if (bodies.length + routers.length === 0) return "";
  const what = `${bodies.length} moved bod${bodies.length === 1 ? "y" : "ies"} and ${routers.length} router part(s)`;
  const grew = [
    ...bodies
      .filter((b) => b.bodyCode.new > b.bodyCode.old)
      .map((b) => `${b.name}'s body`),
    ...routers
      .filter((r) => r.code.new > r.code.old)
      .map((r) => `${r.name}'s procedures`),
  ];
  if (grew.length > 0)
    return `moved code grew on the way (${grew.join(", ")}), which ${what} don't explain`;
  if (rise.sized) {
    let left = 0;
    let imports = 0;
    for (const f of moves.files) {
      if (!joined.has(f.file)) continue;
      left += codeLines(f.newCut) - codeLines(f.oldCut);
      const [was, now] = [
        importLines(f.file, f.old.join("\n")),
        importLines(f.file, f.new.join("\n")),
      ];
      imports += now.statements + now.types - was.statements - was.types;
    }
    if (left === imports) return undefined;
    return `once check-commit's ${what} are cut out, the code lines left across ${[...joined].sort().join(", ")} change by ${left}, their import lines by ${imports} (they may differ by nothing)`;
  }
  return functionsTakenOver(git, sha, rise, bodies, what);
}

/** The function-entry half of structuralLines. */
function functionsTakenOver(
  git: Git,
  sha: string,
  rise: Rise,
  bodies: Moves["bodies"],
  what: string,
): string | undefined {
  const empty: SizeBaseline = { files: {}, functions: {} };
  const read = (ref: string): SizeBaseline => {
    const text = treeAt(git, ref)(SIZE_FILE);
    return text === undefined ? empty : (JSON.parse(text) as SizeBaseline);
  };
  const [base, head] = [read(`${sha}^`), read(sha)];
  const joined = rise.joined ?? [];
  const wasByName = new Map<string, number>();
  for (const f of joined)
    for (const [fn, n] of Object.entries(base.functions[f] ?? {}))
      wasByName.set(fn, Math.max(n, wasByName.get(fn) ?? 0));
  // Each moved body's new function takes the entry of the arrow it left.
  const takes = new Map<string, { was: string; extra: number }>();
  for (const b of bodies) {
    const text = treeAt(git, `${sha}^`)(b.from);
    if (text === undefined) continue;
    const key = [...functionEntries(b.from, text)].find(
      ([, at]) =>
        at.line === b.start.line && at.character === b.start.character,
    )?.[0];
    if (key === undefined) continue;
    const old = base.functions[b.from] ?? {};
    for (const k of Object.keys(old))
      if (k === key || k.startsWith(`${key}.`))
        takes.set(`${b.to}\0${b.name}${k.slice(key.length)}`, {
          was: `${b.from}\0${k}`,
          extra: k === key ? Math.max(0, b.wrapper.new - b.wrapper.old) : 0,
        });
  }
  const problems: string[] = [];
  const call = (k: string) => (k.endsWith(")") ? k : `${k}()`);
  for (const f of joined)
    for (const [fn, n] of Object.entries(head.functions[f] ?? {})) {
      const taken = takes.get(`${f}\0${fn}`);
      if (taken) {
        const [wf, wk] = taken.was.split("\0") as [string, string];
        const was = base.functions[wf]![wk]!;
        if (n > was + taken.extra)
          problems.push(
            `${f} ${call(fn)}: ${n}, ${call(wk)} ${was} +${taken.extra} for its signature`,
          );
        continue;
      }
      const was = base.functions[f]?.[fn] ?? wasByName.get(fn);
      if (was === undefined)
        problems.push(`${f} ${call(fn)}: ${n}, no entry it takes over`);
      else if (n > was)
        problems.push(`${f} ${call(fn)}: ${n}, ${was} at the base`);
    }
  if (problems.length === 0) return undefined;
  return `${what} don't explain ${problems.join("; ")}`;
}

/** The import-lines rule alone (before owner Q14). */
function importLinesOnly(
  git: Git,
  sha: string,
  rise: Rise,
): string | undefined {
  const files = rise.sized ?? rise.entry.paths;
  const was = treeAt(git, `${sha}^`);
  const now = treeAt(git, sha);
  let added = 0;
  for (const f of files) {
    const [before, after] = [importLines(f, was(f)), importLines(f, now(f))];
    added += after.types - before.types;
    if (rise.sized) added += after.statements - before.statements;
  }
  if (rise.by === added) return undefined;
  const lines = rise.sized ? "import lines" : `lines of import("…") types`;
  return `rose +${rise.by} in a Mechanical: commit, which adds ${added} ${lines} across ${files.join(", ")} (a move or split rises by exactly those)`;
}

/** `This reverts commit <sha>` in a message → that sha. */
const reverted = (message: string) =>
  /^This reverts commit ([0-9a-f]{7,40})\b/m.exec(message)?.[1];

export type RatchetReport = { failures: string[]; excused: string[] };

export function checkRatchets(
  base: string,
  head: string,
  cwd = process.cwd(),
): RatchetReport {
  const git = gitIn(cwd);
  const commits = commitsWithFiles(git, base, head);
  const merges = git("rev-list", "--merges", "--reverse", `${base}..${head}`)
    .split("\n")
    .filter(Boolean);
  const failures: string[] = [];
  const excused: string[] = [];

  const judge = (
    sha: string,
    message: string,
    rises: Rise[],
    renamedKeys = new Map<string, KnownRename>(),
  ) => {
    const mechanical = trailerValues(message, "Mechanical").length > 0;
    let read: Moves | undefined;
    const moves = () => (read ??= movesOf(git, sha));
    const undone = reverted(message);
    // A revert may put an entry back to its value before the reverted commit.
    let stillHigher: Set<string> | undefined;
    try {
      if (undone)
        stillHigher = new Set(
          risesBetween(git, `${undone}^`, sha).map((r) => r.id),
        );
    } catch {
      stillHigher = undefined; // the reverted commit isn't in this clone
    }
    for (const rise of rises) {
      const where = `${short(sha)} ${rise.file}: ${rise.text}${plus(rise)}`;
      const renamedBy = renamedKeys.get(rise.id);
      if (renamedBy) {
        excused.push(`${where}, by "${KNOWN_RENAMED}: ${renamedBy.value}"`);
        continue;
      }
      if (stillHigher && !stillHigher.has(rise.id)) {
        excused.push(
          `${where}, by the revert of ${short(undone!)}: back to its value before it`,
        );
        continue;
      }
      const verdict = excuse(rise, message);
      if (!verdict.ok) {
        failures.push(
          `${where}: ${verdict.why} — write "${RAISE}: ${rise.file} — <entry> +<N>, <reason>" in that commit (owner's OK, or a Mechanical: commit's import lines)`,
        );
        continue;
      }
      const imports = mechanical
        ? notImportLines(git, sha, rise, moves)
        : undefined;
      if (imports) failures.push(`${where}: ${imports}`);
      else excused.push(`${where}, by "${verdict.trailer}"`);
    }
  };

  for (const c of commits) {
    for (const key of [RAISE, RERECORD])
      for (const p of trailerScopes(c.message, key).problems)
        failures.push(`${short(c.sha)}: ${p}`);
    const known = readKnownRenamed(c.message);
    const lists = known.renames.filter((r) => LIST_FILES.includes(r.file));
    for (const r of known.renames)
      if (!lists.includes(r))
        known.problems.push(
          `"${KNOWN_RENAMED}: ${r.value}": ${r.file} holds no known list (${LIST_FILES.join(", ")})`,
        );
    const touched = c.files.some((f) => RATCHET_FILES.includes(f));
    const rises = touched ? risesBetween(git, `${c.sha}^`, c.sha) : [];
    const renamed = knownRenamed(
      lists,
      rises,
      (file) => ({
        was: listEntries(file, treeAt(git, `${c.sha}^`)(file) ?? ""),
        now: listEntries(file, treeAt(git, c.sha)(file) ?? ""),
      }),
      renamesIn(git, `${c.sha}^`, c.sha),
    );
    for (const p of [...known.problems, ...renamed.problems])
      failures.push(`${short(c.sha)}: ${p}`);
    if (touched) judge(c.sha, c.message, rises, renamed.excused);
  }
  for (const sha of merges)
    judge(sha, git("log", "-1", "--format=%B", sha), mergeRises(git, sha));

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
  failures.push(...baselineRises(changed, commits).map((r) => r.text));
  return { failures, excused };
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
  const { failures, excused } = checkRatchets(base, head);
  for (const line of excused) console.log(`excused: ${line}`);
  for (const line of failures) console.error(line);
  const since = base.slice(0, 12);
  if (failures.length > 0) {
    console.error(
      `\n${failures.length} ratchet failure(s) since ${since}, ${excused.length} rise(s) excused; see docs/RULES.md § Refactoring.`,
    );
    return 1;
  }
  console.log(
    excused.length > 0
      ? `Ratchets: ${excused.length} rise(s) since ${since}, each excused in its own commit (listed above); nothing else rose and no baseline file changed.`
      : `Ratchets: nothing rose and no baseline file changed since ${since}.`,
  );
  return 0;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  process.exitCode = main(process.argv.slice(2));
