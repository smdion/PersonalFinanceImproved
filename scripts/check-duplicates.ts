/**
 * Duplicate-code ratchet over src/ (CI blocks on it; owner Q1). jscpd, pinned
 * in package.json, runs with scripts/ratchets/jscpd.json: TypeScript and TSX,
 * 100 tokens and 5 lines at least, generated files, tax data, the schema
 * folders and the reference data left out (tests live outside src/).
 * scripts/ratchets/duplicates.json records its copied blocks and lines; a new
 * pasted copy raises them and fails. A fall is recorded with `--update` in
 * the same commit, which never raises; check-ratchets holds the file against
 * the base like the lint counts.
 *
 *   pnpm check:duplicates [--update]
 *
 * `JSCPD=<path>` runs another jscpd binary of the same version (a worktree
 * without the install: `npx --yes jscpd@<version>` prints the same counts).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DUPLICATES_FILE, type Duplicates } from "./ratchets/counts";

export const JSCPD_CONFIG = "scripts/ratchets/jscpd.json";
const SCANNED = "src";

/** One copied block as jscpd's JSON report gives it. */
export type Clone = {
  lines: number;
  firstFile: { name: string; start: number; end: number };
  secondFile: { name: string; start: number; end: number };
};
export type Report = {
  duplicates: Clone[];
  statistics: { total: { clones: number; duplicatedLines: number } };
};

export function countsOf(report: Report): Duplicates {
  const { clones, duplicatedLines } = report.statistics.total;
  return { blocks: clones, lines: duplicatedLines };
}

const where = (f: Clone["firstFile"]) =>
  `${SCANNED}/${f.name}:${f.start}-${f.end}`;

/** The blocks, longest first, for a rise's report. */
export function describeClones(clones: Clone[]): string[] {
  return [...clones]
    .sort((a, b) => b.lines - a.lines)
    .map(
      (c) =>
        `  ${c.lines} lines: ${where(c.firstFile)} = ${where(c.secondFile)}`,
    );
}

export type Verdict = {
  ok: boolean;
  /** What `--update` writes: the measured counts when none rose. */
  update?: Duplicates;
  messages: string[];
};

/** A rise fails; a fall fails until `--update` records it. */
export function judge(recorded: Duplicates, measured: Duplicates): Verdict {
  const keys = ["blocks", "lines"] as const;
  const rose = keys.filter((k) => measured[k] > recorded[k]);
  const fell = keys.filter((k) => measured[k] < recorded[k]);
  const line = (k: (typeof keys)[number]) =>
    `${k}: ${measured[k]}, ${recorded[k]} recorded`;
  if (rose.length > 0)
    return {
      ok: false,
      messages: [
        `Copied code rose (${rose.map(line).join("; ")}).`,
        "Call the shared code instead of pasting it. A rise the owner accepts is",
        `recorded by hand with a Ratchet-raise: ${DUPLICATES_FILE} — <blocks|lines> +N, <reason> trailer.`,
      ],
    };
  if (fell.length > 0)
    return {
      ok: false,
      update: measured,
      messages: [
        `Copied code fell (${fell.map(line).join("; ")}): run pnpm check:duplicates --update and commit ${DUPLICATES_FILE}.`,
      ],
    };
  return {
    ok: true,
    messages: [`Copied code: ${line("blocks")}; ${line("lines")}.`],
  };
}

/** Runs jscpd over src/ and reads its JSON report. */
export function runJscpd(cwd: string, bin = process.env.JSCPD): Report {
  const jscpd = bin ?? path.join(cwd, "node_modules", ".bin", "jscpd");
  const out = fs.mkdtempSync(path.join(tmpdir(), "jscpd-"));
  try {
    execFileSync(
      jscpd,
      ["--config", JSCPD_CONFIG, "--output", out, "--no-tips", SCANNED],
      { cwd, stdio: ["ignore", "ignore", "inherit"] },
    );
    const text = fs.readFileSync(path.join(out, "jscpd-report.json"), "utf8");
    return JSON.parse(text) as Report;
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
}

function main(argv: string[]): number {
  const cwd = process.cwd();
  const file = path.join(cwd, DUPLICATES_FILE);
  const recorded = JSON.parse(fs.readFileSync(file, "utf8")) as Duplicates;
  const report = runJscpd(cwd);
  const verdict = judge(recorded, countsOf(report));
  if (argv.includes("--update") && verdict.update) {
    fs.writeFileSync(file, `${JSON.stringify(verdict.update, null, 2)}\n`);
    console.log(`${DUPLICATES_FILE} lowered.`);
    return 0;
  }
  for (const m of verdict.messages)
    (verdict.ok ? console.log : console.error)(m);
  if (!verdict.ok && !verdict.update)
    console.error(
      ["Every copied block now:", ...describeClones(report.duplicates)].join(
        "\n",
      ),
    );
  return verdict.ok ? 0 : 1;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  process.exitCode = main(process.argv.slice(2));
