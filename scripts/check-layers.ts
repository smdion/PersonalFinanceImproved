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
}

/** Every failure line for `found` against the `known` list (and `base`). */
export function compareWithKnown(
  found: LayerViolation[],
  known: LayerViolation[],
  base?: LayerBase,
): string[] {
  const foundKeys = new Set(found.map(key));
  const knownKeys = new Set(known.map(key));
  const baseKeys = base ? new Set(base.entries.map(key)) : undefined;
  const errors: string[] = [];
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
