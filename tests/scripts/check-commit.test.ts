import { describe, expect, it } from "vitest";
import {
  checkCommit,
  countPriorFixes,
  looksLikeFix,
  parseMessage,
  parseNumstat,
  spotsFromDiff,
  srcLinesChanged,
  type CommitFacts,
} from "../../scripts/check-commit";

const DAY = 86_400;

function facts(
  overrides: Partial<CommitFacts> & { raw?: string } = {},
): CommitFacts {
  const { raw = "fix: keep the gap year\n\nThe draw ran twice.", ...rest } =
    overrides;
  return {
    message: parseMessage(raw),
    files: [{ file: "src/lib/pure/a.ts", added: 10, deleted: 2 }],
    spots: [],
    priorFixes: new Map(),
    ...rest,
  };
}

const rules = (f: CommitFacts) => checkCommit(f).map((warning) => warning.rule);

describe("parseMessage", () => {
  it("splits subject, body and trailers, and drops comment lines", () => {
    const parsed = parseMessage(
      "refactor: move X\n\nWhy it moved.\n\nMechanical: move only\nCo-Authored-By: A <a@b.c>\n# a git comment\n",
    );
    expect(parsed.subject).toBe("refactor: move X");
    expect(parsed.body).toBe("Why it moved.");
    expect(parsed.trailers).toEqual({
      Mechanical: "move only",
      "Co-Authored-By": "A <a@b.c>",
    });
  });
});

describe("checkCommit", () => {
  it("passes a prefixed commit with a body under the limits", () => {
    expect(rules(facts())).toEqual([]);
  });

  it("warns on a subject without a type prefix", () => {
    expect(rules(facts({ raw: "Keep the gap year\n\nBecause." }))).toEqual([
      "prefix",
    ]);
  });

  it("warns on a missing body unless the change is mechanical", () => {
    expect(rules(facts({ raw: "fix: keep the gap year" }))).toEqual(["why"]);
    expect(
      rules(facts({ raw: "refactor: move\n\nMechanical: rename" })),
    ).toEqual([]);
  });

  it("counts src/ lines, not tests or generated SQLite files", () => {
    const files = parseNumstat(
      [
        "300\t50\tsrc/lib/pure/a.ts",
        "60\t0\tsrc/lib/pure/b.ts",
        "900\t0\ttests/pure/a.test.ts",
        "500\t500\tsrc/lib/db/sqlite/people.ts",
        "-\t-\tpublic/logo.png",
      ].join("\n"),
    );
    expect(srcLinesChanged(files)).toBe(410);
    expect(rules(facts({ files }))).toEqual(["size"]);
    expect(
      rules(facts({ files, raw: "refactor: split\n\nMechanical: move only" })),
    ).toEqual([]);
  });

  it("allows 400 src/ lines exactly", () => {
    const files = [{ file: "src/a.ts", added: 200, deleted: 200 }];
    expect(rules(facts({ files }))).toEqual([]);
  });

  it("limits an engine or tax commit to 8 src/ files", () => {
    const files = Array.from({ length: 9 }, (_, index) => ({
      file:
        index === 0
          ? "src/lib/calculators/engine/x.ts"
          : `src/lib/pure/f${index}.ts`,
      added: 1,
      deleted: 0,
    }));
    expect(rules(facts({ files }))).toEqual(["engine-files"]);
    expect(rules(facts({ files: files.slice(0, 8) }))).toEqual([]);
    const outsideEngine = files.map((change, index) =>
      index === 0 ? { ...change, file: "src/lib/pure/f0.ts" } : change,
    );
    expect(rules(facts({ files: outsideEngine }))).toEqual([]);
  });

  it("asks for a Concept: trailer on a second fix in one spot", () => {
    const priorFixes = new Map([["src/lib/pure/a.ts::draw", 1]]);
    expect(rules(facts({ priorFixes }))).toEqual(["second-fix"]);
    const withConcept = facts({
      priorFixes,
      raw: "fix: keep the gap year\n\nWhy.\n\nConcept: none, a typo",
    });
    expect(rules(withConcept)).toEqual([]);
  });

  it("sends a third fix to the advisor even with a Concept: trailer", () => {
    const priorFixes = new Map([["src/lib/pure/a.ts::draw", 2]]);
    const withConcept = facts({
      priorFixes,
      raw: "fix: keep the gap year\n\nWhy.\n\nConcept: gap-year draw",
    });
    expect(rules(withConcept)).toEqual(["third-fix"]);
  });

  it("ignores prior fixes on a commit that isn't a fix", () => {
    const priorFixes = new Map([["src/lib/pure/a.ts::draw", 3]]);
    expect(
      rules(facts({ priorFixes, raw: "feat: add a card\n\nWhy." })),
    ).toEqual([]);
  });
});

describe("looksLikeFix", () => {
  it("reads a fix: prefix, or the word fix in an unprefixed subject", () => {
    expect(looksLikeFix("fix(engine): x")).toBe(true);
    expect(looksLikeFix("Fixes the RMD year")).toBe(true);
    expect(looksLikeFix("feat: prefix the subject")).toBe(false);
    expect(looksLikeFix("feat: fix the subject line")).toBe(false);
  });
});

describe("spotsFromDiff", () => {
  it("names the function each src/ hunk sits in", () => {
    const diff = [
      "diff --git a/src/lib/pure/a.ts b/src/lib/pure/a.ts",
      "--- a/src/lib/pure/a.ts",
      "+++ b/src/lib/pure/a.ts",
      "@@ -10,2 +10,2 @@ export function computeDraw(input: DrawInput) {",
      "@@ -40 +40 @@ const routeTiers = (tiers: Tier[]) => {",
      "@@ -60 +60 @@ export class Ledger {",
      "@@ -70 +70 @@",
      "+++ b/tests/pure/a.test.ts",
      '@@ -1 +1 @@ describe("x", () => {',
    ].join("\n");
    expect(spotsFromDiff(diff)).toEqual([
      "src/lib/pure/a.ts::computeDraw",
      "src/lib/pure/a.ts::routeTiers",
      "src/lib/pure/a.ts::Ledger",
    ]);
  });
});

describe("countPriorFixes", () => {
  const now = 1_800_000_000;
  const spot = "src/lib/pure/a.ts::computeDraw";
  const history = [
    { sha: "a", time: now - 5 * DAY, subject: "fix: draw", spots: [spot] },
    {
      sha: "b",
      time: now - 10 * DAY,
      subject: "Fix the draw again",
      spots: [spot],
    },
    { sha: "c", time: now - 40 * DAY, subject: "fix: too old", spots: [spot] },
    {
      sha: "d",
      time: now - 2 * DAY,
      subject: "feat: not a fix",
      spots: [spot],
    },
    {
      sha: "e",
      time: now - 1 * DAY,
      subject: "fix: elsewhere",
      spots: ["src/b.ts::other"],
    },
    { sha: "f", time: now + DAY, subject: "fix: later", spots: [spot] },
  ];

  it("counts earlier fix commits in the 30-day window that touched the spot", () => {
    expect(countPriorFixes([spot], now, history).get(spot)).toBe(2);
  });

  it("leaves out the commit being checked", () => {
    expect(
      countPriorFixes([spot], now - 5 * DAY + 1, history, "a").get(spot),
    ).toBe(1);
  });
});
