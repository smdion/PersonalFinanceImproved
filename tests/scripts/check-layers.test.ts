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
  applyEntryMoves,
  compareWithKnown,
  parseEntryMoves,
  parseRenames,
  renameMove,
  renameEntries,
  renamesSince,
  unsoundMove,
  type EntryMove,
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

describe("Layers-renamed trailers", () => {
  const BARREL = "src/lib/calculators/types.ts";
  const INDEX = "src/lib/pure/engine/types/index.ts";
  const FROM = "src/lib/config/withdrawal-routing.ts";
  const message = `refactor: move\n\nLayers-renamed: ${FROM} -> ${BARREL} => ${FROM} -> ${INDEX}\n`;

  it("parses one pair per trailer line", () => {
    expect(parseEntryMoves(message)).toEqual([
      { from: { from: FROM, to: BARREL }, to: { from: FROM, to: INDEX } },
    ]);
    expect(parseEntryMoves("no trailer here")).toEqual([]);
  });

  it("re-points a base entry that is gone, so the new edge isn't new", () => {
    const base: LayerBase = {
      entries: [entry(FROM, BARREL)],
      rules: new Set([RULE]),
      moved: parseEntryMoves(message),
    };
    const now = [entry(FROM, INDEX)];
    expect(compareWithKnown(now, now, base)).toEqual([]);
    expect(compareWithKnown(now, now, { ...base, moved: [] })).toHaveLength(1);
  });

  it("refuses a trailer whose old entry is still on the list", () => {
    const known = [entry(FROM, BARREL), entry(FROM, INDEX)];
    const { errors } = applyEntryMoves(
      [entry(FROM, BARREL)],
      known,
      parseEntryMoves(message),
    );
    expect(errors).toHaveLength(1);
  });

  it("accepts a trailer the renames since the ref already applied", () => {
    // From one base git pairs the rename itself; from an older one it can't.
    const moves = parseEntryMoves(message);
    const known = [entry(FROM, INDEX)];
    expect(applyEntryMoves([entry(FROM, INDEX)], known, moves)).toEqual({
      entries: [entry(FROM, INDEX)],
      errors: [],
    });
    expect(applyEntryMoves([entry(FROM, BARREL)], known, moves).errors).toEqual(
      [],
    );
    expect(applyEntryMoves([], known, moves).errors).toHaveLength(1);
  });

  it("re-points a chain of trailers, oldest first", () => {
    const MID = "src/lib/pure/engine/types/mid.ts";
    const moves = [
      ...parseEntryMoves(
        `Layers-renamed: ${FROM} -> ${BARREL} => ${FROM} -> ${MID}`,
      ),
      ...parseEntryMoves(
        `Layers-renamed: ${FROM} -> ${MID} => ${FROM} -> ${INDEX}`,
      ),
    ];
    const known = [entry(FROM, INDEX)];
    expect(applyEntryMoves([entry(FROM, BARREL)], known, moves)).toEqual({
      entries: [entry(FROM, INDEX)],
      errors: [],
    });
  });

  it("keeps the rule: a trailer can't turn one rule's entry into another's", () => {
    const base: LayerBase = {
      entries: [entry(FROM, BARREL)],
      rules: new Set([RULE, "no-circular"]),
      moved: parseEntryMoves(message),
    };
    const now: LayerViolation[] = [
      { rule: "no-circular", from: FROM, to: INDEX },
    ];
    expect(compareWithKnown(now, now, base)).toHaveLength(1);
  });
});

describe("a trailer whose files move later", () => {
  it("reads the trailer's paths through the renames after its commit", () => {
    const moved = renameMove(
      {
        from: {
          from: "src/lib/pure/engine/a.ts",
          to: "src/lib/pure/engine/b.ts",
        },
        to: {
          from: "src/lib/pure/engine/b.ts",
          to: "src/lib/pure/engine/types/c.ts",
        },
      },
      new Map([
        ["src/lib/pure/engine/a.ts", "src/lib/pure/engine/a.ts"],
        ["src/lib/pure/engine/b.ts", "src/lib/pure/engine/b.ts"],
      ]),
    );
    expect(moved).toEqual({
      from: {
        from: "src/lib/pure/engine/a.ts",
        to: "src/lib/pure/engine/b.ts",
      },
      to: {
        from: "src/lib/pure/engine/b.ts",
        to: "src/lib/pure/engine/types/c.ts",
      },
    });
  });
});

describe("a sound Layers-renamed (todo:360)", () => {
  const at = (n: string) => `src/lib/pure/${n}.ts`;
  const [A, B, C, X, Y] = [at("a"), at("b"), at("c"), at("x"), at("y")];
  const move = (gone?: string[]): EntryMove => ({
    from: { from: A, to: B },
    to: { from: X, to: Y },
    ...(gone && { gone }),
  });

  it("refuses swapping a fixed break for an unrelated one of the same rule", () => {
    expect(unsoundMove(move(), RULE, [])).toMatch(/share no file/);
    const { errors } = applyEntryMoves(
      [entry(A, B)],
      [entry(X, Y)],
      [move()],
      [entry(X, Y)],
    );
    expect(errors).toHaveLength(1);
  });

  it("pairs edges that share an endpoint, or whose old file the commit removed", () => {
    expect(
      unsoundMove({ ...move(), to: { from: A, to: C } }, RULE, []),
    ).toBeUndefined();
    expect(unsoundMove(move([B]), RULE, [])).toBeUndefined();
  });

  it("pairs no-circular edges only when the new edge's cycle holds the old edge's files", () => {
    const circular = (cycle: string[]): LayerViolation => ({
      rule: "no-circular",
      from: X,
      to: Y,
      cycle,
    });
    expect(
      unsoundMove(move(), "no-circular", [circular([Y, A, B, X])]),
    ).toBeUndefined();
    expect(unsoundMove(move(), "no-circular", [circular([Y, A, X])])).toMatch(
      /cycle doesn't hold src\/lib\/pure\/b\.ts/,
    );
    // Sharing an endpoint isn't enough for a cycle: any pair in it can be reported.
    expect(
      unsoundMove({ ...move(), to: { from: A, to: C } }, "no-circular", []),
    ).toMatch(/cycle doesn't hold/);
  });
});
