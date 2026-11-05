/**
 * scripts/check-layers.ts: the known list only shrinks, and with `--base`
 * a moved file's entries are the base's entries under the new path, not
 * new ones. The rename map is read from a throwaway git repo.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import {
  compareWithKnown,
  parseRenames,
  renameEntries,
  renamesSince,
  type LayerBase,
  type LayerViolation,
} from "../../scripts/check-layers";

const RULE = "pure-has-no-io";
const OLD = "src/lib/calculators/old-home.ts";
const NEW = "src/lib/pure/area/new-home.ts";
const DB = "src/lib/db/index.ts";

const entry = (from: string, to = DB): LayerViolation => ({
  rule: RULE,
  from,
  to,
});

describe("parseRenames", () => {
  it("maps each R line's old path to its new one and ignores the rest", () => {
    const renames = parseRenames(
      [`R100\t${OLD}\t${NEW}`, "M\tsrc/a.ts", "A\tsrc/b.ts", "D\tsrc/c.ts"]
        .concat(["R087\tsrc/d.ts\tsrc/e.ts", ""])
        .join("\n"),
    );
    expect([...renames]).toEqual([
      [OLD, NEW],
      ["src/d.ts", "src/e.ts"],
    ]);
  });
});

describe("compareWithKnown with a base", () => {
  const rules = new Set([RULE]);
  const renames = new Map([[OLD, NEW]]);

  it("passes a moved file whose entry moved with it", () => {
    const base: LayerBase = {
      entries: renameEntries([entry(OLD), entry("src/x.ts", OLD)], renames),
      rules,
    };
    const known = [entry(NEW), entry("src/x.ts", NEW)];
    expect(compareWithKnown(known, known, base)).toEqual([]);
  });

  it("reads the moved entry as added without the rename map", () => {
    const base: LayerBase = { entries: [entry(OLD)], rules };
    expect(compareWithKnown([entry(NEW)], [entry(NEW)], base)).toEqual([
      `${NEW} → ${DB} breaks layer rule ${RULE}; never add to the known list (entry added to .dependency-cruiser-known-violations.json)`,
    ]);
  });

  it("still fails a new break in the moved file", () => {
    const base: LayerBase = {
      entries: renameEntries([entry(OLD)], renames),
      rules,
    };
    const added = entry(NEW, "src/lib/db/schema.ts");
    expect(compareWithKnown([entry(NEW), added], [entry(NEW)], base)).toEqual([
      `${NEW} → src/lib/db/schema.ts breaks layer rule ${RULE}; never add to the known list`,
    ]);
    expect(
      compareWithKnown([entry(NEW), added], [entry(NEW), added], base),
    ).toHaveLength(1);
  });
});

describe("renamesSince", () => {
  let repo: string;
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repo, encoding: "utf8" });

  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(tmpdir(), "check-layers-"));
    git("init", "-q", "-b", "main");
    git("config", "user.email", "t@example.invalid");
    git("config", "user.name", "t");
    fs.mkdirSync(path.join(repo, path.dirname(OLD)), { recursive: true });
    const body = Array.from(
      { length: 30 },
      (_, i) => `export const v${i} = ${i};`,
    );
    fs.writeFileSync(path.join(repo, OLD), body.join("\n") + "\n");
    fs.writeFileSync(path.join(repo, "kept.ts"), "export {};\n");
    git("add", ".");
    git("commit", "-q", "-m", "base");
    git("tag", "base");
    fs.mkdirSync(path.join(repo, path.dirname(NEW)), { recursive: true });
    git("mv", OLD, NEW);
    // A move commit also rewrites imports: the rename is still found.
    fs.appendFileSync(path.join(repo, NEW), "export const moved = true;\n");
    fs.appendFileSync(path.join(repo, "kept.ts"), "export const k = 1;\n");
    git("commit", "-q", "-am", "move");
  });

  afterAll(() => {
    if (repo?.startsWith(tmpdir())) fs.rmSync(repo, { recursive: true });
  });

  it("returns the moved file and nothing else", () => {
    expect([...renamesSince("base", repo)]).toEqual([[OLD, NEW]]);
  });
});
