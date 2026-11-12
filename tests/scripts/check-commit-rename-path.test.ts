/**
 * AR9 proof (owner 2026-11-11): a `Rename-path:` commit is proven when
 * re-running scripts/rename-trpc-path.ts on its parent, with its trailers,
 * gives its tree byte for byte; it then counts as `Mechanical:`.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkCommit,
  gitIn,
  parseMessage,
  renamePathProblem,
  type CommitFacts,
} from "../../scripts/check-commit";
import {
  RENAME_MESSAGE,
  makeFixture,
  type Fixture,
} from "./rename-trpc-path-fixture";

const facts = (raw: string, over: Partial<CommitFacts> = {}): CommitFacts => ({
  message: parseMessage(raw),
  // Over the 400-line limit, so the size rule shows whether it's exempt.
  files: [{ file: "src/components/a.tsx", added: 300, deleted: 300 }],
  spots: [],
  priorFixes: new Map(),
  ...over,
});
const rules = (f: CommitFacts) => checkCommit(f).map((w) => w.rule);

describe("checkCommit with Rename-path:", () => {
  it("a proven commit counts as Mechanical: (no size rule)", () => {
    expect(rules(facts(RENAME_MESSAGE))).toEqual([]);
  });

  it("an unproven one warns and keeps the size rule", () => {
    expect(
      rules(facts(RENAME_MESSAGE, { notRenamePath: "differing paths: x" })),
    ).toEqual(["rename-path", "size"]);
  });

  it("a commit without Rename-path: is unaffected", () => {
    const plain = "refactor(gadgets): x\n\nWhy.\n";
    expect(rules(facts(plain))).toEqual(["size"]);
    // A stray proof result is ignored without the trailer.
    expect(rules(facts(plain, { notRenamePath: "x" }))).toEqual(["size"]);
    const mechanical = `${plain}\nMechanical: a move\n`;
    expect(rules(facts(mechanical, { notMechanical: "not a move" }))).toEqual([
      "mechanical",
      "size",
    ]);
  });
});

describe("renamePathProblem on an invented router", () => {
  let f: Fixture;
  beforeEach(() => {
    f = makeFixture();
  });
  afterEach(() => f.remove());

  const prove = (raw = RENAME_MESSAGE, parent = "HEAD^", tree = "HEAD") =>
    renamePathProblem(
      raw,
      parent,
      f.git("rev-parse", `${tree}^{tree}`),
      gitIn(f.dir),
    );

  it("passes a commit the script made, staged or committed", () => {
    f.rename();
    f.git("add", "-A");
    // The commit-msg hook's case: the staged tree against HEAD.
    expect(
      renamePathProblem(
        RENAME_MESSAGE,
        "HEAD",
        f.git("write-tree"),
        gitIn(f.dir),
      ),
    ).toBeUndefined();
    f.git("commit", "-q", "-m", RENAME_MESSAGE);
    expect(prove(f.git("log", "-1", "--format=%B"))).toBeUndefined();
    // No temporary worktree is left behind.
    expect(f.git("worktree", "list").split("\n")).toHaveLength(1);
  }, 120_000);

  it("fails a hand-edited extra line, naming the path", () => {
    f.rename();
    const file = path.join(f.dir, "src/components/gadget-list.tsx");
    fs.appendFileSync(file, "// by hand\n");
    f.git("add", "-A");
    f.git("commit", "-q", "-m", RENAME_MESSAGE);
    expect(prove()).toMatch(
      /gives a different tree; differing paths: src\/components\/gadget-list\.tsx$/,
    );
  }, 120_000);

  it("fails a map the commit doesn't follow, and a parent without the script", () => {
    f.rename();
    f.git("add", "-A");
    f.git("commit", "-q", "-m", RENAME_MESSAGE);
    const other = RENAME_MESSAGE.replaceAll(
      "gadgets.listContributionRows",
      "gadgets.listContributedRows",
    );
    expect(prove(other)).toMatch(/differing paths: .*gadgets\.ts/);
    f.git("rm", "-q", "scripts/rename-trpc-path.ts");
    f.git("commit", "-q", "-m", "chore: drop\n\nWhy.");
    expect(prove(RENAME_MESSAGE, "HEAD", "HEAD")).toMatch(
      /has no scripts\/rename-trpc-path\.ts to re-run/,
    );
  }, 120_000);
});
