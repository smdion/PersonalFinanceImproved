import { describe, expect, it } from "vitest";
import {
  checkCommit,
  countPriorFixes,
  looksLikeFix,
  notAMove,
  renamePair,
  parseMessage,
  parseNumstat,
  trailerValues,
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
        index === 0 ? "src/lib/pure/engine/x.ts" : `src/lib/pure/f${index}.ts`,
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

  it("counts the engine and tax code in lib/pure, not the other areas", () => {
    const nine = (first: string) =>
      Array.from({ length: 9 }, (_, index) => ({
        file: index === 0 ? first : `src/lib/pure/budget/f${index}.ts`,
        added: 1,
        deleted: 0,
      }));
    for (const first of [
      "src/lib/pure/engine/projection.ts",
      "src/lib/pure/tax/brackets.ts",
      "src/lib/tax-data/2027.ts",
      "src/lib/config/tax-tables.ts",
      // Withholding and the IRS limits are tax law too.
      "src/lib/pure/paycheck/paycheck.ts",
      "src/lib/pure/contributions/irs-limits.ts",
    ]) {
      expect(rules(facts({ files: nine(first) }))).toEqual(["engine-files"]);
    }
    for (const first of [
      "src/lib/pure/contributions/contribution-totals.ts",
      "src/lib/pure/savings/savings.types.ts",
    ]) {
      expect(rules(facts({ files: nine(first) }))).toEqual([]);
    }
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

  it("asks a revert for its own reason, beyond git's boilerplate line", () => {
    const boilerplate =
      "This reverts commit 0bad0a56cadb4750ae191f7117d30bb9f25be6eb.";
    expect(
      rules(facts({ raw: `Revert "perf: memoize rows"\n\n${boilerplate}` })),
    ).toEqual(["prefix", "revert-reason"]);
    expect(
      rules(facts({ raw: `revert(paycheck): undo X\n\n${boilerplate}` })),
    ).toEqual(["revert-reason"]);
    expect(
      rules(
        facts({
          raw: `revert(paycheck): undo X\n\n${boilerplate}\n\nIt dropped a stored value.`,
        }),
      ),
    ).toEqual([]);
    expect(
      rules(
        facts({
          raw: `revert: undo X\n\n${boilerplate}\n\nWhy: it dropped a stored value.`,
        }),
      ),
    ).toEqual([]);
  });

  it("leaves a commit that only mentions a revert alone", () => {
    expect(
      rules(facts({ raw: "fix: restore X\n\nThis reverts commit abc1234." })),
    ).toEqual([]);
  });

  it("ignores prior fixes on a commit that isn't a fix", () => {
    const priorFixes = new Map([["src/lib/pure/a.ts::draw", 3]]);
    expect(
      rules(facts({ priorFixes, raw: "feat: add a card\n\nWhy." })),
    ).toEqual([]);
  });
});

describe("trailerValues", () => {
  it("returns every value of a repeated trailer, which parseMessage keeps once", () => {
    const raw =
      "chore: x\n\nWhy.\n\nRatchet-raise: a.json — one\nRatchet-raise: b.json — two\n# Ratchet-raise: c.json — comment\n";
    expect(trailerValues(raw, "Ratchet-raise")).toEqual([
      "a.json — one",
      "b.json — two",
    ]);
    expect(parseMessage(raw).trailers["Ratchet-raise"]).toBe("b.json — two");
  });
});

describe("notAMove", () => {
  const renamed = parseNumstat(
    "2\t2\tsrc/lib/{calculators => pure/tax}/a.ts\n1\t1\tsrc/b.ts",
  );
  const diff = (body: string[]) =>
    [
      "diff --git a/src/b.ts b/src/b.ts",
      "--- a/src/b.ts",
      "+++ b/src/b.ts",
      "@@ -1 +1 @@",
      ...body,
    ].join("\n");

  it("passes a rename whose other lines are import and path rewrites", () => {
    expect(
      notAMove(
        renamed,
        diff([
          '-import { a } from "@/lib/calculators/a";',
          '+import { a } from "@/lib/pure/tax/a";',
          "@@ -9 +9 @@",
          // Split so the vi.mock target check doesn't read sample text as a mock.
          "-vi." + 'mock("@/lib/calculators/a", () => ({}));',
          "+vi." + 'mock("@/lib/pure/tax/a", () => ({}));',
          "@@ -20,2 +21,3 @@",
          " import {",
          "+  shared,",
          ' } from "./shared";',
          "diff --git a/sizes.json b/sizes.json",
          "--- a/sizes.json",
          "+++ b/sizes.json",
          "@@ -40 +41 @@",
          '-  "src/lib/calculators/a.ts": 500,',
          "@@ -60 +60 @@",
          '+  "src/lib/pure/tax/a.ts": 500',
        ]),
      ),
    ).toBeUndefined();
  });

  it("reads a lone name as an import only inside an import statement", () => {
    expect(
      notAMove(renamed, diff([" total(", "-  taxYear,", "+  year,", " );"])),
    ).toMatch(/2 changed line\(s\) are neither imports/);
  });

  it("fails without a rename, or with a changed line that isn't a path", () => {
    expect(notAMove(parseNumstat("1\t1\tsrc/b.ts"), diff([]))).toBe(
      "git sees no rename and no code moved between files",
    );
    expect(
      notAMove(renamed, diff(["-  return total * 2;", "+  return total * 3;"])),
    ).toMatch(/2 changed line\(s\) are neither imports nor path rewrites/);
  });

  it("makes checkCommit refuse the exemption for a commit that isn't a move", () => {
    const files = [{ file: "src/a.ts", added: 300, deleted: 200 }];
    expect(
      rules(
        facts({
          files,
          raw: "refactor: rename\n\nWhy.\n\nMechanical: move only",
          notMechanical: "git sees no rename",
        }),
      ),
    ).toEqual(["mechanical", "size"]);
  });
});
describe("notAMove: a split moves code between files", () => {
  const numstat = parseNumstat(
    "0\t3\tsrc/server/helpers/big.ts\n4\t0\tsrc/lib/pure/area/part.ts",
  );
  const split = (oldSide: string[], newSide: string[]) =>
    [
      "diff --git a/src/lib/pure/area/part.ts b/src/lib/pure/area/part.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/src/lib/pure/area/part.ts",
      "@@ -0,0 +1,4 @@",
      ...newSide,
      "diff --git a/src/server/helpers/big.ts b/src/server/helpers/big.ts",
      "--- a/src/server/helpers/big.ts",
      "+++ b/src/server/helpers/big.ts",
      "@@ -10,3 +9,0 @@",
      ...oldSide,
    ].join("\n");
  const body = ["function total(a: number) {", "  return a * 2;", "}"];

  it("passes code moved verbatim into a new part, exported there", () => {
    const newSide = [
      '+import { x } from "@/lib/x";',
      "+export function total(a: number) {",
      "+  return a * 2;",
      "+}",
    ];
    expect(
      notAMove(
        numstat,
        split(
          body.map((l) => `-${l}`),
          newSide,
        ),
      ),
    ).toBeUndefined();
  });

  it("fails a split that changes a line on the way", () => {
    const newSide = ["+function total(a: number) {", "+  return a * 3;", "+}"];
    expect(
      notAMove(
        numstat,
        split(
          body.map((l) => `-${l}`),
          newSide,
        ),
      ),
    ).toMatch(/2 changed line\(s\)/);
  });

  it("fails code deleted rather than moved", () => {
    expect(
      notAMove(
        numstat,
        split(
          body.map((l) => `-${l}`),
          [],
        ),
      ),
    ).toBe("git sees no rename and no code moved between files");
    const partial = ["+function total(a: number) {", "+}"];
    expect(
      notAMove(
        numstat,
        split(
          body.map((l) => `-${l}`),
          partial,
        ),
      ),
    ).toMatch(/1 changed line\(s\).*return a \* 2/);
  });

  it("passes whole declarations moved in another order, the old file exporting what it keeps", () => {
    const two = ["function half(a: number) {", "  return a / 2;", "}"];
    const oldFile = [
      "diff --git a/src/server/helpers/big.ts b/src/server/helpers/big.ts",
      "--- a/src/server/helpers/big.ts",
      "+++ b/src/server/helpers/big.ts",
      "@@ -1,9 +1,3 @@",
      "-function keep() {",
      "+export function keep() {",
      "   return 1;",
      " }",
      ...body.map((l) => `-${l}`),
      ...two.map((l) => `-${l}`),
    ];
    const part = [
      "diff --git a/src/lib/pure/area/part.ts b/src/lib/pure/area/part.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/src/lib/pure/area/part.ts",
      "@@ -0,0 +1,7 @@",
      '+import { keep } from "@/server/helpers/big";',
      ...two.map((l) => `+${l}`),
      "+",
      ...body.map((l) => `+${l}`),
    ];
    expect(notAMove(numstat, [...part, ...oldFile].join("\n"))).toBeUndefined();
  });

  it("fails an edit a moved function's own lines hide: an argument, a cast, a brace", () => {
    const call = [
      "function total(row: Row, a: number) {",
      "  if (a > 0) {",
      "    return add(",
      "      row as ContribRow,",
      "      a,",
      "    );",
      "  }",
      "  return 0;",
      "}",
    ];
    const moved = (edit: (lines: string[]) => string[]) =>
      notAMove(
        numstat,
        split(
          call.map((l) => `-${l}`),
          edit(call).map((l) => `+${l}`),
        ),
      );
    expect(moved((l) => l)).toBeUndefined();
    // A dropped argument on its own line.
    expect(moved((l) => l.filter((x) => x !== "      a,"))).toMatch(
      /1 changed line\(s\).*a,/,
    );
    // A changed cast on its own line.
    expect(
      moved((l) => l.map((x) => x.replace("ContribRow", "CapPassRow"))),
    ).toMatch(/2 changed line\(s\).*as/);
    // A removed closing brace.
    expect(moved((l) => l.filter((x) => x !== "  }"))).toMatch(
      /1 changed line\(s\).*\}/,
    );
  });

  it("fails two statements swapped inside a moved function", () => {
    const steps = [
      "function total(a: number) {",
      "  log(a);",
      "  save(a);",
      "  return a;",
      "}",
    ];
    const swapped = [steps[0]!, steps[2]!, steps[1]!, steps[3]!, steps[4]!];
    expect(
      notAMove(
        numstat,
        split(
          steps.map((l) => `-${l}`),
          swapped.map((l) => `+${l}`),
        ),
      ),
    ).toMatch(/not whole top-level statements kept in order/);
  });

  it("lets a split take its doc comments and reword the old header", () => {
    const oldSide = [
      "-/** Doubles it. */",
      ...body.map((l) => `-${l}`),
      "-// old header",
    ];
    const newSide = [
      "+/** Doubles it. */",
      "+export function total(a: number) {",
      "+  return a * 2;",
      "+}",
    ];
    expect(notAMove(numstat, split(oldSide, newSide))).toBeUndefined();
  });

  it("reads a register row's code cells as paths, and only those", () => {
    const row = (fn: string, gap: string) =>
      `| LIM-20 | Periods per year | ${fn} | Owner design | ${gap} |`;
    const register = (before: string, after: string) =>
      [
        split(
          body.map((l) => `-${l}`),
          body.map((l) => `+${l}`),
        ),
        "diff --git a/docs/CALCULATIONS.md b/docs/CALCULATIONS.md",
        "--- a/docs/CALCULATIONS.md",
        "+++ b/docs/CALCULATIONS.md",
        "@@ -9 +9 @@",
        `-${before}`,
        `+${after}`,
      ].join("\n");
    const was = row("`server/helpers/big.ts:total`", "None");
    expect(
      notAMove(
        numstat,
        register(was, row("`lib/pure/area/part.ts:total`, `jobPay`", "None")),
      ),
    ).toBeUndefined();
    expect(
      notAMove(
        numstat,
        register(was, row("`lib/pure/area/part.ts:total`", "Fixed")),
      ),
    ).toMatch(/2 changed line\(s\)/);
  });

  it("doesn't count a line edited in place as moved", () => {
    const oneFile = [
      "diff --git a/src/b.ts b/src/b.ts",
      "--- a/src/b.ts",
      "+++ b/src/b.ts",
      "@@ -1 +1 @@",
      "-  return total * 2;",
      "+  return total * 3;",
    ].join("\n");
    expect(notAMove(parseNumstat("1\t1\tsrc/b.ts"), oneFile)).toBe(
      "git sees no rename and no code moved between files",
    );
  });
});

describe("notAMove: a move's bookkeeping and bare names", () => {
  const renamed = parseNumstat(
    "1\t1\tsrc/lib/{calculators/engine/tax-gross-up.ts => pure/engine/withdrawal-solver.ts}\n1\t1\tdocs/DESIGN.md\n2\t2\tsize-baseline.json\n1\t1\tsrc/lib/generated/engine-hash.ts",
  );
  const file = (name: string, body: string[]) => [
    `diff --git a/${name} b/${name}`,
    `--- a/${name}`,
    `+++ b/${name}`,
    "@@ -1 +1 @@",
    ...body,
  ];

  it("reads a renamed file's bare name as a path", () => {
    expect(
      renamePair(
        "src/lib/{calculators/engine/tax-gross-up.ts => pure/engine/withdrawal-solver.ts}",
      ),
    ).toEqual([
      "src/lib/calculators/engine/tax-gross-up.ts",
      "src/lib/pure/engine/withdrawal-solver.ts",
    ]);
    const diff = file("docs/DESIGN.md", [
      "-The solver lives in tax-gross-up.ts.",
      "+The solver lives in withdrawal-solver.ts.",
    ]).join("\n");
    expect(notAMove(renamed, diff)).toBeUndefined();
  });

  it("leaves size entries, the generated hash and AUTO-GEN counts to their own checks", () => {
    const diff = [
      ...file("size-baseline.json", [
        '-    "a": 500,',
        '+    "a": 498,',
        '-    "b": 410',
        '+    "b": 412',
      ]),
      ...file("src/lib/generated/engine-hash.ts", [
        "-export const ENGINE_HASH = 1;",
        "+export const ENGINE_HASH = 2;",
      ]),
      ...file("docs/DESIGN.md", [
        "-**<!-- AUTO-GEN:engineModules -->33<!-- /AUTO-GEN --> modules**",
        "+**<!-- AUTO-GEN:engineModules -->34<!-- /AUTO-GEN --> modules**",
      ]),
    ].join("\n");
    expect(notAMove(renamed, diff)).toBeUndefined();
  });

  it("passes a line prettier re-wrapped because its path changed length", () => {
    const diff = file("docs/DESIGN.md", [
      '-  const x: import("@/lib/pure/types/calculators").T | undefined;',
      "+  const x:",
      '+    | import("@/lib/pure/types/calculators").T',
      "+    | undefined;",
    ]).join("\n");
    expect(notAMove(renamed, diff)).toBeUndefined();
  });

  it("passes a call prettier broke into arguments with trailing commas", () => {
    const diff = file("docs/DESIGN.md", [
      "-vi." +
        'mock("@/lib/calculators/a", async (orig) => ({ ...(await orig()) }));',
      "+vi." + "mock(",
      '+  "@/lib/pure/tax/a",',
      "+  async (orig) => ({",
      "+    ...(await orig()),",
      "+  }),",
      "+);",
    ]).join("\n");
    expect(notAMove(renamed, diff)).toBeUndefined();
  });

  it("lets a file the move creates or deletes bring or take its comments", () => {
    const diff = [
      "diff --git a/src/lib/old-barrel.ts b/src/lib/old-barrel.ts",
      "deleted file mode 100644",
      "--- a/src/lib/old-barrel.ts",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-// Barrel re-export.",
      '-export * from "./types/a";',
    ].join("\n");
    expect(notAMove(renamed, diff)).toBeUndefined();
    const edited = file("docs/DESIGN.md", [
      "+// a new comment in a kept file",
    ]).join("\n");
    expect(notAMove(renamed, edited)).toMatch(
      /neither imports nor path rewrites/,
    );
  });

  it("still refuses an identifier rename or a logic change", () => {
    const diff = file("docs/DESIGN.md", [
      "-call computeGrossUp() first",
      "+call solveWithdrawal() first",
    ]).join("\n");
    expect(notAMove(renamed, diff)).toMatch(
      /neither imports nor path rewrites/,
    );
  });
  it("refuses an operator or a string changed inside a re-wrap", () => {
    const wrapped = (one: string, two: string[]) =>
      file("docs/DESIGN.md", [`-${one}`, ...two.map((l) => `+${l}`)]).join(
        "\n",
      );
    // Bitwise to logical OR.
    expect(
      notAMove(
        renamed,
        wrapped("const f = a | b;", ["const f =", "  a || b;"]),
      ),
    ).toMatch(/neither imports nor path rewrites/);
    // A space inside a string.
    expect(
      notAMove(
        renamed,
        wrapped('const s = label("a b");', [
          "const s = label(",
          '  "ab",',
          ");",
        ]),
      ),
    ).toMatch(/neither imports nor path rewrites/);
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
