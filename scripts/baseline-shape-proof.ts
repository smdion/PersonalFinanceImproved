/**
 * The proof a shape-only baseline re-record carries (v0.10.3 owner Q3:
 * a response that changes shape without a value changing is re-recorded
 * under `Baseline-rerecord: shape`, with a check that flattening the new
 * shape gives back the old files' values).
 *
 *   pnpm tsx scripts/baseline-shape-proof.ts --base <rev> --shape <name>
 *
 * Every behavior-baseline file (`tests/baseline/__baseline__/`, `__sync__/`,
 * `__text__/`) that differs between `<rev>` and the working tree is read on
 * both sides; the named shape's flatten turns each side into the shape
 * before any of the re-records it undoes, and the two must be equal exactly
 * (same keys, same values). A side already in that shape flattens to
 * itself. A file added or deleted fails. Prints one line per folder and
 * exits 1 on any difference.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import { describeEligibility } from "../src/lib/config/eligibility-labels";
import type { EligibilityReason } from "../src/lib/config/eligibility-reason";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

const FOLDERS = ["__baseline__", "__sync__", "__text__"].map(
  (f) => `tests/baseline/${f}`,
);

const isObject = (v: Json | undefined): v is JsonObject =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** Applies `row` to every element of every `individualAccountBalances`
 *  array in the tree. */
function mapAccountRows(tree: Json, row: (r: JsonObject) => JsonObject): Json {
  if (Array.isArray(tree)) return tree.map((v) => mapAccountRows(v, row));
  if (!isObject(tree)) return tree;
  return Object.fromEntries(
    Object.entries(tree).map(([k, v]) => [
      k,
      k === "individualAccountBalances" && Array.isArray(v)
        ? v.map((r) => (isObject(r) ? row(r) : r))
        : mapAccountRows(v, row),
    ]),
  );
}

/** Plan commit 10: an account-year row's `draw` group lifts back to the
 *  row as it is; its `roth` group lifts back with the `roth` prefix
 *  (`roth.basisDrawn` → `rothBasisDrawn`). */
function flattenAccountYearGroups(tree: Json): Json {
  return mapAccountRows(tree, ({ draw, roth, ...rest }) => {
    const out: JsonObject = { ...rest };
    if (isObject(draw)) Object.assign(out, draw);
    if (isObject(roth))
      for (const [k, v] of Object.entries(roth))
        out[`roth${k[0]!.toUpperCase()}${k.slice(1)}`] = v;
    return out;
  });
}

/** One side of the comparison: a baseline file as that side has it. */
type Side = { file: string; read: (file: string) => Json };

/** Plan commit 11: an account-year row's `draw.reason` (a structured
 *  fact) goes back to the prose `draw.eligibilityReason` it replaced,
 *  through `describeEligibility`. A `__text__` pin holds the reason's text
 *  and flags; its numbers (an age, a year, a basis) are in the same
 *  side's `computeProjection` file, at the same row under `result`. A
 *  numbers file keeps no prose, so there the reason just goes. */
function describeReasons(tree: Json, side: Side): Json {
  const text = /__text__\/([^/]+)\.json$/.exec(side.file);
  if (!text) return mapAccountRows(tree, dropReason);
  const numbers = side.read(
    `tests/baseline/__baseline__/${text[1]}/projection.computeProjection.json`,
  );
  const child = (v: Json | undefined, key: string | number) =>
    Array.isArray(v) ? v[key as number] : isObject(v) ? v[key] : undefined;
  if (!isObject(tree) || !Array.isArray(tree.projectionByYear)) return tree;
  const years = child(child(numbers, "result"), "projectionByYear");
  return {
    ...tree,
    projectionByYear: tree.projectionByYear.map((year, y) => {
      const rows = child(year, "individualAccountBalances");
      if (!isObject(year) || !Array.isArray(rows)) return year;
      const numberRows = child(child(years, y), "individualAccountBalances");
      return {
        ...year,
        individualAccountBalances: rows.map((row, r) => {
          const draw = child(row, "draw");
          const reason = child(draw, "reason");
          if (!isObject(row) || !isObject(draw) || !isObject(reason))
            return row;
          const figures = child(child(child(numberRows, r), "draw"), "reason");
          const whole = {
            ...(isObject(figures) ? figures : {}),
            ...reason,
          } as EligibilityReason;
          const { reason: _, ...rest } = draw;
          return {
            ...row,
            draw: { ...rest, eligibilityReason: describeEligibility(whole) },
          };
        }),
      };
    }),
  };
}

/** A numbers file's row without `draw.reason` (it kept no prose). */
function dropReason(row: JsonObject): JsonObject {
  const { draw } = row;
  if (!isObject(draw) || !("reason" in draw)) return row;
  const { reason: _, ...rest } = draw;
  return { ...row, draw: rest };
}

const SHAPES: Record<string, (tree: Json, side: Side) => Json> = {
  "account-year-groups": (tree) => flattenAccountYearGroups(tree),
  "eligibility-reason": (tree, side) =>
    flattenAccountYearGroups(describeReasons(tree, side)),
};

/** The tree with every object's keys in one order, as text. */
function canonical(tree: Json): string {
  const sort = (v: Json): Json =>
    Array.isArray(v)
      ? v.map(sort)
      : isObject(v)
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, sort(v[k]!)]),
          )
        : v;
  return JSON.stringify(sort(tree));
}

function arg(name: string): string {
  const i = process.argv.indexOf(name);
  const value = i >= 0 ? process.argv[i + 1] : undefined;
  if (!value) {
    console.error(
      "usage: baseline-shape-proof.ts --base <rev> --shape " +
        Object.keys(SHAPES).join("|"),
    );
    process.exit(2);
  }
  return value;
}

function main() {
  const base = arg("--base");
  const flatten = SHAPES[arg("--shape")];
  if (!flatten) throw new Error(`unknown shape; one of ${Object.keys(SHAPES)}`);
  const changes = execFileSync(
    "git",
    ["diff", "--name-status", "--no-renames", base, "--", ...FOLDERS],
    { encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t") as [string, string]);
  const untracked = execFileSync(
    "git",
    ["ls-files", "--others", "--exclude-standard", "--", ...FOLDERS],
    { encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean);
  let failed = untracked.map((f) => `added: ${f}`);
  const perFolder = new Map<string, number>();
  for (const [status, file] of changes) {
    if (status !== "M") {
      failed.push(`${status === "A" ? "added" : "deleted"}: ${file}`);
      continue;
    }
    const before = JSON.parse(
      execFileSync("git", ["show", `${base}:${file}`], { encoding: "utf8" }),
    ) as Json;
    const after = JSON.parse(fs.readFileSync(file, "utf8")) as Json;
    const sides = (rev: string | null): Side => ({
      file,
      read: (f) =>
        JSON.parse(
          rev
            ? execFileSync("git", ["show", `${rev}:${f}`], { encoding: "utf8" })
            : fs.readFileSync(f, "utf8"),
        ) as Json,
    });
    if (
      canonical(flatten(after, sides(null))) !==
      canonical(flatten(before, sides(base)))
    ) {
      failed.push(`values differ: ${file}`);
      continue;
    }
    const folder = file.split("/")[2]!;
    perFolder.set(folder, (perFolder.get(folder) ?? 0) + 1);
  }
  for (const [folder, n] of perFolder)
    console.log(`${folder}: ${n} files, flattened new = old`);
  if (failed.length > 0) {
    failed = failed.slice(0, 20);
    console.error(failed.join("\n"));
    process.exit(1);
  }
  console.log(`${changes.length} files re-recorded, every value identical`);
}

main();
