/**
 * scripts/rename-trpc-path.ts on an invented router (AR9 proof): the map
 * comes from the message's `Rename-path:` trailers; every kind of place a
 * path is written follows; a second run, committed or not, changes nothing.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readRenamePaths,
  renamePathTrailers,
} from "../../scripts/check-commit";
import { raisedFor } from "../../scripts/check-size-baseline";
import { makeFixture, type Fixture } from "./rename-trpc-path-fixture";

const abbreviationCount = (f: Fixture) =>
  (
    JSON.parse(f.read("eslint-suppressions.json")) as Record<
      string,
      Record<string, { count: number }>
    >
  )["src/server/routers/gadgets.ts"]?.["ratchet/no-abbreviation"]?.count;

describe("readRenamePaths", () => {
  it("reads every trailer form and prints it back", () => {
    const raw = [
      "refactor: x",
      "",
      "Why.",
      "",
      "Rename-path: a.b → a.c, d -> e.f",
      "Rename-path: g → h",
      "Rename-path-move: src/server/routers/a.ts → src/server/routers/b/a.ts",
      'Rename-path-edit: src/x.ts "  ...a,\\n" → ""',
      "Rename-path-delete: src/server/routers/c.ts",
    ].join("\n");
    const { map, problems } = readRenamePaths(raw);
    expect(problems).toEqual([]);
    expect(map).toEqual({
      paths: [
        ["a.b", "a.c"],
        ["d", "e.f"],
        ["g", "h"],
      ],
      moves: [["src/server/routers/a.ts", "src/server/routers/b/a.ts"]],
      edits: [{ file: "src/x.ts", from: "  ...a,\n", to: "" }],
      deletes: ["src/server/routers/c.ts"],
    });
    expect(
      readRenamePaths(`x: y\n\n${renamePathTrailers(map!).join("\n")}\n`).map,
    ).toEqual(map);
  });

  it("refuses a malformed line, a path renamed twice, and a move alone", () => {
    expect(
      readRenamePaths(
        "x\n\nRename-path: a b → c\nRename-path: d → e, d → f\nRename-path-edit: src/x.ts nope\n",
      ).problems,
    ).toEqual([
      '"Rename-path: a b → c": write Rename-path: <old.path> → <new.path>',
      "Rename-path: d is renamed twice",
      '"Rename-path-edit: src/x.ts nope": write Rename-path-edit: <file> <JSON string from> → <JSON string to>',
    ]);
    expect(
      readRenamePaths("x\n\nRename-path-move: src/a.ts → src/b.ts\n").problems,
    ).toEqual(["a Rename-path-* line needs a Rename-path: line"]);
    expect(readRenamePaths("x\n\nWhy.\n")).toEqual({ problems: [] });
  });
});

describe("raisedFor", () => {
  it("raises only the named files' grown entries and records one over the limit", () => {
    const { baseline, raised } = raisedFor(
      {
        files: { "src/a.ts": 10, "src/b.ts": 10 },
        functions: { "src/a.ts": { big: 160 } },
      },
      {
        files: { "src/a.ts": 12, "src/b.ts": 14, "src/c.ts": 401 },
        functions: { "src/a.ts": { big: 161 } },
      },
      ["src/a.ts", "src/c.ts"],
    );
    expect(baseline).toEqual({
      files: { "src/a.ts": 12, "src/b.ts": 10, "src/c.ts": 401 },
      functions: { "src/a.ts": { big: 161 } },
    });
    expect(raised).toEqual([
      "src/a.ts 10 → 12",
      "src/a.ts big() 160 → 161",
      "src/c.ts 0 → 401",
    ]);
  });
});

describe("rename-trpc-path.ts on an invented router", () => {
  let f: Fixture;
  beforeEach(() => {
    f = makeFixture();
  });
  afterEach(() => f.remove());

  it("renames every place the path is written, then a re-run is a no-op", () => {
    f.rename();
    expect(f.read("src/server/routers/gadgets.ts")).toContain(
      "listContributionRows: protectedProcedure",
    );
    const client = f.read("src/components/gadget-list.tsx");
    expect(client).toContain("utils.gadgets.listContributionRows.invalidate()");
    expect(client).not.toContain("listContribRows");
    expect(f.read("tests/gadgets.test.ts")).toContain(
      '"gadgets.listContributionRows"',
    );
    expect(f.read("docs/GADGETS.md")).toContain(
      "`gadgets.listContributionRows`",
    );
    expect(f.git("status", "--porcelain", "tests/baseline")).toContain(
      "gadgets.listContributionRows.json",
    );
    // The renamed key no longer abbreviates: 2 → 1.
    expect(abbreviationCount(f)).toBe(1);
    // Prettier wraps the longer line: the recorded size rises with it.
    const size = JSON.parse(f.read("size-baseline.json")) as {
      files: Record<string, number>;
    };
    expect(size.files["src/components/gadget-list.tsx"]).toBe(
      client.split("\n").length - 1,
    );

    // A second run on the uncommitted tree: nothing moves (it once
    // lowered the abbreviation count again, reading HEAD as "before").
    f.git("add", "-A");
    const tree = f.git("write-tree");
    f.rename();
    f.git("add", "-A");
    expect(f.git("write-tree")).toBe(tree);
    expect(abbreviationCount(f)).toBe(1);

    // And once committed.
    f.git("commit", "-q", "-m", "refactor: renamed\n\nWhy.");
    f.rename();
    expect(f.git("status", "--porcelain")).toBe("");
  }, 120_000);
});
