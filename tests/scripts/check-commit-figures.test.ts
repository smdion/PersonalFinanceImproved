/**
 * Figure commits (v0.11 G1): a commit that re-records a pinned figure names
 * its item, each moved figure class, and baseline-diff.ts's count line.
 */
import { describe, expect, it } from "vitest";
import {
  checkCommit,
  droppedXfails,
  parseMessage,
  rerecordedFiles,
  rerecordItems,
  type CommitFacts,
  type FileChange,
} from "../../scripts/check-commit";

const COUNT =
  "Behavior baseline: 3 figure(s) moved in 1 baseline file(s) since HEAD.";
const FIGURE =
  "Figure-change: tax/R-S67: federal 5,020 → 4,054, the Taxes page now applies the senior deduction";

function facts(raw: string, files: FileChange[]): CommitFacts {
  return {
    message: parseMessage(raw),
    files,
    spots: [],
    priorFixes: new Map(),
  };
}

const changed = (file: string, deleted = 1): FileChange => ({
  file,
  added: 1,
  deleted,
});

const rules = (raw: string, files: FileChange[]) =>
  checkCommit(facts(raw, files))
    .map((w) => w.rule)
    .filter((rule) => rule.startsWith("figure"));

const message = (...lines: string[]) =>
  ["fix(tax): the senior deduction", "", "Why.", "", ...lines].join("\n");

describe("rerecordedFiles", () => {
  it("reads the baselines, snapshots, answer key and pinned rows that lose or change lines", () => {
    const pinned = [
      "tests/baseline/__baseline__/el-h1/paycheck.json",
      "tests/baseline/__sync__/actual.json",
      "tests/baseline/__text__/e2e-b.json",
      "tests/baseline/__screens__/e2e-b/networth.txt",
      "tests/pure/engine/__snapshots__/engine-snapshot.test.ts.snap",
      "tests/pure/simulation/__snapshots__/monte-carlo-integration.test.ts.snap",
      "tests/pure/tax/answer-key-tax.test.ts",
      "tests/routers/answer-key-paycheck.test.ts",
      "tests/fixtures/answer-key.ts",
      "tests/fixtures/answer-key-household.ts",
      "tests/fixtures/extra-paycheck-materializer-rows.json",
    ];
    expect(rerecordedFiles(pinned.map((f) => changed(f)))).toEqual(pinned);
  });

  it("leaves other tests, other fixtures and added-only pins out", () => {
    expect(
      rerecordedFiles([
        changed("tests/pure/paycheck/paycheck.test.ts"),
        changed("tests/fixtures/known-schema-versions-v0.10.0.json"),
        changed("tests/baseline/screens.test.tsx"),
        changed("tests/baseline/__baseline__/el-h1/new.json", 0),
        changed("tests/pure/tax/answer-key-tax.test.ts", 0),
      ]),
    ).toEqual([]);
  });
});

describe("rerecordItems", () => {
  it("reads the item id that starts check-ratchets' <glob> — <reason>", () => {
    expect(
      rerecordItems(
        parseMessage(
          [
            "x",
            "",
            "Baseline-rerecord: tests/fixtures/x-rows.json — Q1 (owner Q12), EXPECTED.local only",
            "Baseline-rerecord: __baseline__/** — TX5, the 65+ add-on",
            "Baseline-rerecord: __text__/** — none, text only",
            "Baseline-rerecord: Q1",
            "Baseline-rerecord: __text__/** — owner-signed",
          ].join("\n"),
        ),
      ),
    ).toEqual(["Q1", "TX5", "none", undefined, undefined]);
  });
});

describe("checkCommit: figure commits (G1)", () => {
  const baseline = [
    changed("tests/baseline/__baseline__/el-h1/taxes.json"),
    changed("docs/CALCULATIONS.md"),
  ];

  it("passes a re-record with its item, figure lines and count line", () => {
    expect(
      rules(
        message(
          COUNT,
          "",
          FIGURE,
          "Baseline-rerecord: __baseline__/** — TX3, the senior deduction",
        ),
        baseline,
      ),
    ).toEqual([]);
    expect(
      rules(
        message(
          COUNT,
          "",
          FIGURE,
          "Baseline-rerecord: tests/baseline/__baseline__/** — TX3 (owner Y5)",
        ),
        baseline,
      ),
    ).toEqual([]);
  });

  it("warns on a re-record with no Baseline-rerecord line", () => {
    expect(rules(message(COUNT, "", FIGURE), baseline)).toEqual([
      "figure-rerecord",
    ]);
    expect(
      rules(message(), [
        changed("tests/fixtures/extra-paycheck-materializer-rows.json"),
      ]),
    ).toEqual(["figure-rerecord"]);
  });

  it("asks nothing of a commit that adds pins or touches no pinned figure", () => {
    expect(
      rules(message(), [changed("tests/baseline/__text__/new.json", 0)]),
    ).toEqual([]);
    expect(rules(message(), [changed("src/lib/pure/a.ts")])).toEqual([]);
  });

  it("accepts none, <reason> for a re-record that moves no figure", () => {
    expect(
      rules(
        message(
          "Baseline-rerecord: tests/pure/tax/*.ts — none, a comment in the answer key",
        ),
        [changed("tests/pure/tax/answer-key-tax.test.ts")],
      ),
    ).toEqual([]);
    expect(
      rules(
        message(
          "Baseline-rerecord: __screens__/** — none, text only (Visible:)",
        ),
        [changed("tests/baseline/__screens__/e2e-b/networth.txt")],
      ),
    ).toEqual([]);
  });

  it("needs check-ratchets' form, its reason starting with the item id", () => {
    for (const line of [
      "Baseline-rerecord: TX3",
      "Baseline-rerecord: __baseline__/** — owner-signed",
    ])
      expect(rules(message(COUNT, "", FIGURE, line), baseline)).toEqual([
        "figure-rerecord",
      ]);
  });

  it("needs a Figure-change line in its form", () => {
    expect(
      rules(
        message(
          COUNT,
          "",
          "Baseline-rerecord: __baseline__/** — TX3, the senior deduction",
        ),
        baseline,
      ),
    ).toEqual(["figure-change"]);
    expect(
      rules(
        message(
          COUNT,
          "",
          "Figure-change: taxes moved",
          "Baseline-rerecord: __baseline__/** — TX3, the senior deduction",
        ),
        baseline,
      ),
    ).toEqual(["figure-change"]);
  });

  it("needs baseline-diff.ts's count line", () => {
    expect(
      rules(
        message(
          FIGURE,
          "Baseline-rerecord: __baseline__/** — TX3, the senior deduction",
        ),
        baseline,
      ),
    ).toEqual(["figure-count"]);
  });
});

describe("droppedXfails (G2)", () => {
  const diff = (file: string, lines: string[]) =>
    [
      `diff --git a/${file} b/${file}`,
      `--- a/${file}`,
      `+++ b/${file}`,
      "@@ -1,9 +1,9 @@",
      ...lines,
    ].join("\n");
  const flip = diff("tests/pure/tax/answer-key-tax.test.ts", [
    "-  xfail({",
    '-    id: "tax/R-S67",',
    '+  it("tax/R-S67", () => {',
    "   run: () => federal(),",
    '   it.fails("sim/K12 — expected failure until v0.11 x", run);',
    '-  it.fails("sim/K13 — expected failure until v0.11 x", run);',
    '-  it.fails("a wrapper defect, not an answer-key case (v0.11 x)", run);',
  ]);

  it("finds the cases that stop being expected failures, by id", () => {
    expect(droppedXfails(flip)).toEqual(["tax/R-S67", "sim/K13"]);
  });

  it("doesn't count a case moved to another file", () => {
    const moved = [
      diff("tests/a.test.ts", ["-  xfail({", '-    id: "tax/L2",', "-  });"]),
      diff("tests/b.test.ts", ["+  xfail({", '+    id: "tax/L2",', "+  });"]),
    ].join("\n");
    expect(droppedXfails(moved)).toEqual([]);
  });
});

describe("checkCommit: flips name their case, figures their row (G2)", () => {
  const files = [
    changed("tests/pure/tax/answer-key-tax.test.ts"),
    changed("docs/CALCULATIONS.md"),
  ];
  const flipRules = (raw: string, f = files, sha?: string) =>
    checkCommit({
      ...facts(raw, f),
      droppedXfails: ["tax/R-S67"],
      sha,
    })
      .map((w) => w.rule)
      .filter((rule) => rule === "xfail-flip" || rule.startsWith("figure"));
  const item = "Baseline-rerecord: tests/pure/tax/*.ts — TX5, the 65+ add-on";

  it("passes a flip its Figure-change line names", () => {
    expect(flipRules(message(COUNT, "", FIGURE, item))).toEqual([]);
  });

  it("warns on a flip no Figure-change line names", () => {
    const other =
      "Figure-change: tax/R-S678: federal 5,020 → 4,054, the senior deduction";
    expect(flipRules(message(COUNT, "", other, item))).toEqual(["xfail-flip"]);
  });

  it("needs the CALCULATIONS row, or Calculations: none, <reason>", () => {
    const answerKeyOnly = [changed("tests/pure/tax/answer-key-tax.test.ts")];
    expect(flipRules(message(COUNT, "", FIGURE, item), answerKeyOnly)).toEqual([
      "figure-calculations",
    ]);
    expect(
      flipRules(
        message(COUNT, "", FIGURE, item, "Calculations: none, no row yet"),
        answerKeyOnly,
      ),
    ).toEqual([]);
  });

  it("asks no row of a none re-record, nor of Q1, which landed before the rule", () => {
    const answerKeyOnly = [changed("tests/fixtures/x-rows.json")];
    expect(
      checkCommit(
        facts(
          message(
            "Baseline-rerecord: tests/fixtures/x-rows.json — none, a comment",
          ),
          answerKeyOnly,
        ),
      ).map((w) => w.rule),
    ).toEqual([]);
    expect(
      checkCommit({
        ...facts(message(COUNT, "", FIGURE, item), answerKeyOnly),
        sha: "301bcb446186cf96ba919283ec035276e915ea43",
      }).map((w) => w.rule),
    ).toEqual([]);
  });
});

describe("checkCommit: commit types say behavior (G8)", () => {
  const typeRules = (raw: string, f: FileChange[] = []) =>
    checkCommit(facts(raw, f))
      .map((w) => w.rule)
      .filter((rule) => rule === "refactor-figure" || rule === "api-breaking");
  const rerecord = "Baseline-rerecord: __baseline__/** — TX5, the add-on";

  it("warns on a refactor that re-records a figure, not on a fix", () => {
    expect(typeRules(`refactor(tax): x\n\nWhy.\n\n${rerecord}`)).toEqual([
      "refactor-figure",
    ]);
    expect(typeRules(`fix(tax): x\n\nWhy.\n\n${rerecord}`)).toEqual([]);
    expect(
      typeRules(
        "refactor(ui): x\n\nWhy.\n\nBaseline-rerecord: __screens__/** — none, text only",
      ),
    ).toEqual([]);
  });

  it("pairs a breaking subject with its API: line", () => {
    const api = "API: settings.list: returns { ok, error } instead of throwing";
    expect(typeRules(`feat!: x\n\nWhy.\n\n${api}`)).toEqual([]);
    expect(typeRules(`fix(settings)!: x\n\nWhy.\n\n${api}`)).toEqual([]);
    expect(typeRules(`feat(settings): x\n\nWhy.\n\n${api}`)).toEqual([
      "api-breaking",
    ]);
    expect(typeRules("feat!: x\n\nWhy.")).toEqual(["api-breaking"]);
    expect(typeRules("fix(settings): x\n\nWhy.")).toEqual([]);
  });
});
