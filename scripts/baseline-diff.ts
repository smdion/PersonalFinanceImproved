/**
 * What a rewrite of the behavior baseline moved, one line per figure:
 * `household H, procedure P, field F: $A → $B`. Reads every changed file
 * under tests/baseline/__baseline__/ between a git revision and the working
 * tree (staged or not), so a commit that rewrites the baseline on purpose
 * (v0.11's figure fixes) can show what it changed instead of a 17 MB diff.
 * Leaves are compared one by one; a field that appears or disappears shows
 * "(none)" on its missing side.
 *
 * Usage: tsx scripts/baseline-diff.ts [<rev>] [--limit N]
 *   <rev> defaults to HEAD; --limit caps the lines printed (default 200).
 */
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const BASELINE_DIR = "tests/baseline/__baseline__";

export interface FigureChange {
  household: string;
  procedure: string;
  field: string;
  before: unknown;
  after: unknown;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

/** Each leaf that differs between two parsed JSON values, by path. */
export function changedLeaves(
  before: unknown,
  after: unknown,
  at = "",
): { field: string; before: unknown; after: unknown }[] {
  if (isObject(before) && isObject(after)) {
    const list = Array.isArray(before) && Array.isArray(after);
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
    keys.sort((a, b) => (list ? Number(a) - Number(b) : a.localeCompare(b)));
    return keys.flatMap((k) =>
      changedLeaves(
        before[k],
        after[k],
        list ? `${at}[${k}]` : at ? `${at}.${k}` : k,
      ),
    );
  }
  return Object.is(before, after) ? [] : [{ field: at, before, after }];
}

/** A figure as the summary prints it: dollars for numbers. */
export function shown(v: unknown): string {
  if (v === undefined) return "(none)";
  if (typeof v === "number")
    return `$${v.toLocaleString("en-US", { maximumFractionDigits: 6 })}`;
  return JSON.stringify(v);
}

/** One summary line. */
export function summaryLine(c: FigureChange): string {
  return `household ${c.household}, procedure ${c.procedure}, field ${c.field}: ${shown(c.before)} → ${shown(c.after)}`;
}

/** The changes in one baseline file, from its two texts (null: absent). */
export function fileChanges(
  file: string,
  beforeText: string | null,
  afterText: string | null,
): FigureChange[] {
  const rel = path.relative(BASELINE_DIR, file);
  const parse = (t: string | null): unknown =>
    t === null ? undefined : JSON.parse(t);
  return changedLeaves(parse(beforeText), parse(afterText)).map((l) => ({
    household: path.dirname(rel),
    procedure: path.basename(rel, ".json"),
    before: l.before,
    after: l.after,
    field: l.field || "(whole file)",
  }));
}

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
}

function main() {
  const args = process.argv.slice(2);
  const limitAt = args.indexOf("--limit");
  const limit = limitAt >= 0 ? Number(args[limitAt + 1]) : 200;
  const rev =
    args.find((a, i) => !a.startsWith("--") && i !== limitAt + 1) ?? "HEAD";
  const files = git(["diff", "--name-only", rev, "--", BASELINE_DIR])
    .split("\n")
    .filter((f) => f.endsWith(".json"));
  const changes = files.flatMap((f) => {
    let before: string | null;
    try {
      before = git(["show", `${rev}:${f}`]);
    } catch {
      before = null;
    }
    const abs = path.join(ROOT, f);
    const after = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
    return fileChanges(f, before, after);
  });
  for (const c of changes.slice(0, limit)) console.log(summaryLine(c));
  if (changes.length > limit)
    console.log(`… ${changes.length - limit} more (--limit ${changes.length})`);
  console.log(
    `${changes.length} figure(s) moved in ${files.length} baseline file(s) since ${rev}.`,
  );
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
)
  main();
