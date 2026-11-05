/**
 * Layer rules: runs dependency-cruiser with .dependency-cruiser.mjs and
 * compares its violations with .dependency-cruiser-known-violations.json.
 *
 * The known list may only shrink:
 *   - a violation not on the list fails;
 *   - an entry that no longer occurs fails until it is deleted (`--prune`
 *     deletes every such entry; it never adds one);
 *   - with `--base <git ref>`, an entry missing from that ref's list fails,
 *     unless its rule is new since that ref (a new rule lands with its list).
 *     The ref's entries are read through the files renamed since it, so a
 *     moved file's known violations are the same entries under its new path.
 *     A break that moves to another edge without a rename (a deleted barrel,
 *     a cycle reported on a different pair) is named by a commit trailer
 *     `Layers-renamed: <from> -> <to> => <from> -> <to>`: it pairs one entry
 *     gone from the ref's list with one new entry of the same rule.
 *
 * Usage: pnpm check:layers [--base origin/main] [--prune]
 */
import { spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const KNOWN_FILE = ".dependency-cruiser-known-violations.json";
const CONFIG_FILE = ".dependency-cruiser.mjs";
const CRUISE_ROOTS = ["src", "scripts", "db-migrate.ts"];

export interface LayerViolation {
  rule: string;
  from: string;
  to: string;
}

const key = (v: LayerViolation) => `${v.rule}\u0000${v.from}\u0000${v.to}`;

export function sortViolations(list: LayerViolation[]): LayerViolation[] {
  const seen = new Map(list.map((v) => [key(v), v]));
  return [...seen.values()].sort((a, b) =>
    key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0,
  );
}

/** The known list and the rule names at the base ref. */
export interface LayerBase {
  entries: LayerViolation[];
  rules: Set<string>;
  /** `Layers-renamed:` pairs from the commits since the ref. */
  moved?: EntryMove[];
}

/** One known break, re-pointed to another edge by a `Layers-renamed:` trailer. */
export interface EntryMove {
  from: { from: string; to: string };
  to: { from: string; to: string };
}

const MOVE_TRAILER =
  /^Layers-renamed:\s*(\S+)\s*->\s*(\S+)\s*=>\s*(\S+)\s*->\s*(\S+)\s*$/gm;

/** Every `Layers-renamed:` trailer in commit message text. */
export function parseEntryMoves(messages: string): EntryMove[] {
  return [...messages.matchAll(MOVE_TRAILER)].map((m) => ({
    from: { from: m[1]!, to: m[2]! },
    to: { from: m[3]!, to: m[4]! },
  }));
}

/** A move's paths as they are at HEAD, through the renames made after its commit. */
export function renameMove(
  m: EntryMove,
  renames: Map<string, string>,
): EntryMove {
  const at = (p: string) => renames.get(p) ?? p;
  return {
    from: { from: at(m.from.from), to: at(m.from.to) },
    to: { from: at(m.to.from), to: at(m.to.to) },
  };
}

/**
 * Every `Layers-renamed:` trailer since the ref, its paths read at HEAD: a
 * trailer names paths as they were in its own commit, and a later commit can
 * move those files.
 */
function entryMovesSince(baseRef: string): EntryMove[] {
  const log = execFileSync(
    "git",
    ["log", "--format=%H%x00%B%x1e", `${baseRef}..HEAD`],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return log
    .split("\x1e")
    .map((record) => record.trim())
    .filter((record) => record.includes("Layers-renamed:"))
    .flatMap((record) => {
      const [sha, message = ""] = record.split("\x00");
      const renames = renamesSince(sha!);
      return parseEntryMoves(message).map((m) => renameMove(m, renames));
    });
}

/**
 * Base entries re-pointed by the trailers: each move needs its old entry in
 * the base list and gone from the current one, with the rule kept, so the
 * list can't grow. Returns the re-pointed base list and an error per move
 * that doesn't qualify.
 */
export function applyEntryMoves(
  entries: LayerViolation[],
  known: LayerViolation[],
  moves: EntryMove[],
): { entries: LayerViolation[]; errors: string[] } {
  const knownKeys = new Set(known.map(key));
  const out = [...entries];
  const errors: string[] = [];
  for (const m of moves) {
    const i = out.findIndex(
      (v) =>
        v.from === m.from.from && v.to === m.from.to && !knownKeys.has(key(v)),
    );
    if (i < 0) {
      errors.push(
        `Layers-renamed: ${m.from.from} -> ${m.from.to} names no base entry that is gone from ${KNOWN_FILE}`,
      );
      continue;
    }
    out[i] = { rule: out[i]!.rule, from: m.to.from, to: m.to.to };
  }
  return { entries: out, errors };
}

/** Every failure line for `found` against the `known` list (and `base`). */
export function compareWithKnown(
  found: LayerViolation[],
  known: LayerViolation[],
  base?: LayerBase,
): string[] {
  const foundKeys = new Set(found.map(key));
  const knownKeys = new Set(known.map(key));
  const errors: string[] = [];
  let baseEntries = base?.entries;
  if (base?.moved?.length) {
    const applied = applyEntryMoves(base.entries, known, base.moved);
    baseEntries = applied.entries;
    errors.push(...applied.errors);
  }
  const baseKeys = baseEntries ? new Set(baseEntries.map(key)) : undefined;
  for (const v of sortViolations(found)) {
    if (!knownKeys.has(key(v))) {
      errors.push(
        `${v.from} → ${v.to} breaks layer rule ${v.rule}; never add to the known list`,
      );
    }
  }
  for (const v of sortViolations(known)) {
    if (baseKeys && base?.rules.has(v.rule) && !baseKeys.has(key(v))) {
      errors.push(
        `${v.from} → ${v.to} breaks layer rule ${v.rule}; never add to the known list (entry added to ${KNOWN_FILE})`,
      );
    } else if (!foundKeys.has(key(v))) {
      errors.push(
        `${v.from} → ${v.to} (${v.rule}) no longer occurs: delete its entry from ${KNOWN_FILE} (pnpm check:layers --prune)`,
      );
    }
  }
  return errors;
}

/** Old path → new path for each `R` line of `git diff --name-status`. */
export function parseRenames(nameStatus: string): Map<string, string> {
  const renames = new Map<string, string>();
  for (const line of nameStatus.split("\n")) {
    const [status, from, to] = line.split("\t");
    if (status?.startsWith("R") && from && to) renames.set(from, to);
  }
  return renames;
}

/** The base list's entries under the paths they have at HEAD. */
export function renameEntries(
  entries: LayerViolation[],
  renames: Map<string, string>,
): LayerViolation[] {
  return entries.map((v) => ({
    rule: v.rule,
    from: renames.get(v.from) ?? v.from,
    to: renames.get(v.to) ?? v.to,
  }));
}

/** Renames between `baseRef` and HEAD (every file pair weighed: `-l0`). */
export function renamesSince(baseRef: string, cwd = ROOT) {
  return parseRenames(
    execFileSync(
      "git",
      ["diff", "-M", "-l0", "--name-status", "--no-color", baseRef, "HEAD"],
      { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    ),
  );
}

interface CruiseOutput {
  summary: {
    violations: { from: string; to: string; rule: { name: string } }[];
  };
}

function cruise(): LayerViolation[] {
  const res = spawnSync(
    "depcruise",
    [...CRUISE_ROOTS, "--config", CONFIG_FILE, "-T", "json"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 },
  );
  let out: CruiseOutput;
  try {
    out = JSON.parse(res.stdout) as CruiseOutput;
  } catch {
    throw new Error(
      `depcruise did not produce a result:\n${res.error?.message ?? ""}${res.stderr}`,
    );
  }
  // An npm target's resolved path depends on the machine: keep the package.
  const pkg = (p: string) =>
    p.replace(/^.*node_modules\/(\.pnpm\/[^/]+\/node_modules\/)?/, "npm:");
  return out.summary.violations.map((v) => ({
    rule: v.rule.name,
    from: v.from,
    to: pkg(v.to),
  }));
}

function readList(text: string): LayerViolation[] {
  return (JSON.parse(text) as LayerViolation[]).map(({ rule, from, to }) => ({
    rule,
    from,
    to,
  }));
}

function main(argv: string[]): number {
  const baseIdx = argv.indexOf("--base");
  const baseRef = baseIdx >= 0 ? argv[baseIdx + 1] : undefined;
  const knownPath = path.join(ROOT, KNOWN_FILE);
  const known = readList(fs.readFileSync(knownPath, "utf8"));
  const found = cruise();

  if (argv.includes("--prune")) {
    const foundKeys = new Set(found.map(key));
    const kept = sortViolations(known.filter((v) => foundKeys.has(key(v))));
    fs.writeFileSync(knownPath, JSON.stringify(kept, null, 2) + "\n");
    console.log(`Pruned ${known.length - kept.length} entries.`);
    return 0;
  }

  let base: LayerBase | undefined;
  if (baseRef) {
    const show = (file: string) =>
      execFileSync("git", ["show", `${baseRef}:${file}`], {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
    try {
      const entries = readList(show(KNOWN_FILE));
      const rules = new Set(
        [...show(CONFIG_FILE).matchAll(/\bname: "([^"]+)"/g)].map((m) => m[1]!),
      );
      base = { entries, rules };
    } catch {
      console.log(`No ${KNOWN_FILE} at ${baseRef}; skipping the growth check.`);
    }
    if (base) {
      base.entries = renameEntries(base.entries, renamesSince(baseRef));
      base.moved = entryMovesSince(baseRef);
    }
  }

  const errors = compareWithKnown(found, known, base);
  if (errors.length > 0) {
    console.error(errors.join("\n"));
    return 1;
  }
  console.log(
    `Layer rules: ${found.length} known violations, none new, none stale.`,
  );
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
