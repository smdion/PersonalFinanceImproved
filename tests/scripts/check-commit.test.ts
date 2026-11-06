import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
  structuralMoves,
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

  it("passes a third fix the advisor passed, recorded in an Advisor: trailer", () => {
    const priorFixes = new Map([["src/lib/pure/a.ts::draw", 2]]);
    const message = (advisor: string) =>
      facts({
        priorFixes,
        raw: `fix: keep the gap year\n\nWhy.\n\nConcept: gap-year draw\nAdvisor: ${advisor}`,
      });
    expect(rules(message("PASS (round 3)"))).toEqual([]);
    expect(rules(message("BLOCK (round 2)"))).toEqual(["third-fix"]);
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

describe("notAMove: a procedure's body moves to a service function", () => {
  const numstat = parseNumstat(
    "1\t7\tsrc/server/routers/foo.ts\n7\t0\tsrc/server/services/foo/summary.ts",
  );
  const body = [
    "const rows = await load(ctx.db, input.year);",
    "const total = rows.reduce(",
    "  (sum, row) => sum + row.amount,",
    "  0,",
    ");",
    "return { rows, total };",
  ];
  /** The same body in the service: re-indented, and prettier joins a call. */
  const moved = [
    "const rows = await load(ctx.db, input.year);",
    "const total = rows.reduce((sum, row) => sum + row.amount, 0);",
    "return { rows, total };",
  ];
  const diff = ({
    params = "{ ctx, input }",
    replacement = "({ ctx, input }) => computeFoo(ctx, input)",
    signature = "export async function computeFoo(ctx: Context, input: Input) {",
    inService = moved,
  }: {
    params?: string;
    replacement?: string[] | string;
    signature?: string;
    inService?: string[];
  } = {}) =>
    [
      "diff --git a/src/server/routers/foo.ts b/src/server/routers/foo.ts",
      "--- a/src/server/routers/foo.ts",
      "+++ b/src/server/routers/foo.ts",
      "@@ -1,12 +1,6 @@",
      ' import { protectedProcedure } from "../trpc";',
      '+import { computeFoo } from "@/server/services/foo/summary";',
      " export const fooRouter = createTRPCRouter({",
      "   foo: protectedProcedure",
      "     .input(x)",
      `-    .query(async (${params}) => {`,
      ...body.map((l) => `-      ${l}`),
      "-    }),",
      ...(typeof replacement === "string"
        ? [`+    .query(${replacement}),`]
        : replacement.map((l) => `+${l}`)),
      " });",
      "diff --git a/src/server/services/foo/summary.ts b/src/server/services/foo/summary.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/src/server/services/foo/summary.ts",
      "@@ -0,0 +1,7 @@",
      '+import type { Context } from "@/server/trpc";',
      "+",
      "+/** The foo summary. */",
      `+${signature}`,
      ...inService.map((l) => `+  ${l}`),
      "+}",
    ].join("\n");

  it("passes a body moved whole, the router calling it with its parameter", () => {
    expect(
      notAMove(
        numstat,
        diff({
          params: "ctx",
          replacement: "(ctx) => computeFoo(ctx)",
          signature: "export async function computeFoo(ctx: Context) {",
          inService: moved.map((l) => l.replace("input.year", "ctx.year")),
        }).replace(
          "await load(ctx.db, input.year);\n-",
          "await load(ctx.db, ctx.year);\n-",
        ),
      ),
    ).toBeUndefined();
  });

  it("passes a body moved whole, the router passing on destructured { ctx, input }", () => {
    expect(notAMove(numstat, diff())).toBeUndefined();
    // Prettier may break the call over lines.
    expect(
      notAMove(
        numstat,
        diff({
          replacement: [
            "    .query(({ ctx, input }) =>",
            "      computeFoo(ctx, input),",
            "    ),",
          ],
        }),
      ),
    ).toBeUndefined();
  });

  it("fails a body with one statement changed", () => {
    expect(
      notAMove(
        numstat,
        diff({ inService: moved.map((l) => l.replace(", 0)", ", 1)")) }),
      ),
    ).toMatch(/changed line\(s\)|not whole top-level statements/);
  });

  it("fails a body with one statement dropped", () => {
    expect(
      notAMove(numstat, diff({ inService: [moved[0]!, moved[2]!] })),
    ).toMatch(/changed line\(s\)|not whole top-level statements/);
  });

  it("fails a body moved partially", () => {
    const partial = [
      "diff --git a/src/server/routers/foo.ts b/src/server/routers/foo.ts",
      "--- a/src/server/routers/foo.ts",
      "+++ b/src/server/routers/foo.ts",
      "@@ -1,9 +1,6 @@",
      " export const fooRouter = createTRPCRouter({",
      "   foo: protectedProcedure.query(async ({ ctx, input }) => {",
      "-    const rows = await load(ctx.db, input.year);",
      "-    const total = rows.reduce((sum, row) => sum + row.amount, 0);",
      "+    const { rows, total } = await computeFoo(ctx, input);",
      "     return { rows, total };",
      "   }),",
      " });",
      "diff --git a/src/server/services/foo/summary.ts b/src/server/services/foo/summary.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/src/server/services/foo/summary.ts",
      "@@ -0,0 +1,4 @@",
      "+export async function computeFoo(ctx: Context, input: Input) {",
      "+  const rows = await load(ctx.db, input.year);",
      "+  const total = rows.reduce((sum, row) => sum + row.amount, 0);",
      "+}",
    ].join("\n");
    expect(notAMove(numstat, partial)).toMatch(
      /changed line\(s\)|not whole top-level statements/,
    );
  });

  it("fails a replacement that does more than call", () => {
    const fails = (replacement: string[] | string) =>
      expect(notAMove(numstat, diff({ replacement }))).toMatch(
        /changed line\(s\)|not whole top-level statements/,
      );
    fails([
      "    .query(({ ctx, input }) => {",
      "      log(input);",
      "      return computeFoo(ctx, input);",
      "    }),",
    ]);
    fails([
      "    .query(async ({ ctx, input }) => {",
      "      await ready(ctx);",
      "      return computeFoo(ctx, input);",
      "    }),",
    ]);
    fails("async ({ ctx, input }) => computeFoo(ctx, await prepare(input))");
    // Arguments swapped against the function's parameters.
    fails("({ ctx, input }) => computeFoo(input, ctx)");
    // A bound name not passed on.
    fails("({ ctx, input }) => computeFoo(ctx)");
    // Its value thrown away.
    fails([
      "    .query(({ ctx, input }) => {",
      "      computeFoo(ctx, input);",
      "    }),",
    ]);
  });

  it("fails a destination function with an extra statement", () => {
    expect(
      notAMove(numstat, diff({ inService: [...moved, "log(total);"] })),
    ).toMatch(/changed line\(s\)|not whole top-level statements/);
    expect(
      notAMove(numstat, diff({ inService: ["log(input);", ...moved] })),
    ).toMatch(/changed line\(s\)|not whole top-level statements/);
  });
});

describe("notAMove: a router split moves whole procedures to a new part", () => {
  let dir: string;
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  const write = (files: Record<string, string[] | null>) => {
    for (const [file, lines] of Object.entries(files)) {
      const full = path.join(dir, file);
      if (lines === null) fs.rmSync(full, { force: true });
      else {
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, `${lines.join("\n")}\n`);
      }
    }
  };
  const procedure = (name: string, call: string) => [
    `  ${name}: protectedProcedure.input(z${name}).query(async ({ ctx, input }) => {`,
    `    const rows = await ${call}(ctx.db, input.year);`,
    "    return rows.map((row) => row.amount);",
    "  }),",
  ];
  const [a, b, c] = [
    procedure("a", "loadA"),
    procedure("b", "loadB"),
    procedure("c", "loadC"),
  ];
  const trpc =
    'import { createTRPCRouter, protectedProcedure } from "../trpc";';
  const parent = (props: string[], imports: string[] = []) => [
    trpc,
    'import { loadA, loadB, loadC, za, zb, zc } from "./lib";',
    ...imports,
    "",
    "export const fooRouter = createTRPCRouter({",
    ...props,
    "});",
  ];
  const part = (open: string, props: string[], close = "});") => [
    open.includes("createTRPCRouter")
      ? trpc
      : 'import { protectedProcedure } from "../trpc";',
    'import { loadB, loadC, zb, zc } from "./lib";',
    "",
    open,
    ...props,
    close,
  ];
  const ROUTER = "export const barRouter = createTRPCRouter({";
  const OBJECT = "export const barProcedures = {";
  /** notAMove on the change from the base router to `files`. */
  const split = (files: Record<string, string[] | null>) => {
    git("checkout", "-q", "-f", "main");
    git("clean", "-qfd");
    write(files);
    git("add", "-A");
    return notAMove(
      parseNumstat(git("diff", "--cached", "-M", "--numstat")),
      git("diff", "--cached", "-M", "-U1000000"),
    );
  };
  const FOO = "src/routers/foo.ts";
  const BAR = "src/routers/bar.ts";
  const mounted = (mount = "  bar: barRouter,") =>
    parent([...a, mount], ['import { barRouter } from "./bar";']);

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-router-split-"));
    git("init", "-q", "-b", "main");
    git("config", "user.email", "t@example.invalid");
    git("config", "user.name", "Test");
    write({ [FOO]: parent([...a, ...b, ...c]) });
    git("add", "-A");
    git("commit", "-q", "-m", "base");
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("passes procedures moved whole into a createTRPCRouter part the parent mounts", () => {
    expect(
      split({ [FOO]: mounted(), [BAR]: part(ROUTER, [...b, ...c]) }),
    ).toBeUndefined();
    const moves = structuralMoves(
      parseNumstat(git("diff", "--cached", "-M", "--numstat")),
      git("diff", "--cached", "-M", "-U1000000"),
    );
    expect(moves.routers).toEqual([
      {
        from: FOO,
        to: BAR,
        name: "barRouter",
        kind: "router",
        properties: 2,
        code: { old: 8, new: 8 },
      },
    ]);
  });

  it("passes a procedures object the parent spreads, and a part that skips a procedure", () => {
    expect(
      split({
        [FOO]: parent(
          [...a, "  ...barProcedures,"],
          ['import { barProcedures } from "./bar";'],
        ),
        [BAR]: part(OBJECT, [...b, ...c], "};"),
      }),
    ).toBeUndefined();
    expect(
      split({
        [FOO]: parent(
          [...a, ...b, "  bar: barRouter,"],
          ['import { barRouter } from "./bar";'],
        ),
        [BAR]: part(ROUTER, c),
      }),
    ).toBeUndefined();
    // Two parts, each mounted once.
    expect(
      split({
        [FOO]: parent(
          [...a, "  bar: barRouter,", "  baz: bazRouter,"],
          [
            'import { barRouter } from "./bar";',
            'import { bazRouter } from "./baz";',
          ],
        ),
        [BAR]: part(ROUTER, b),
        "src/routers/baz.ts": part(
          "export const bazRouter = createTRPCRouter({",
          c,
        ),
      }),
    ).toBeUndefined();
  });

  it("fails the part without its mount", () => {
    // The shape needs the wrapper and mount cut: without a mount it isn't one.
    expect(
      split({ [FOO]: parent(a), [BAR]: part(ROUTER, [...b, ...c]) }),
    ).toMatch(/changed line\(s\)|not whole top-level statements/);
  });

  it("fails an extra line in the part or the parent", () => {
    const fails = (files: Record<string, string[] | null>) =>
      expect(split(files)).toMatch(
        /changed line\(s\)|not whole top-level statements/,
      );
    fails({
      [FOO]: mounted(),
      [BAR]: [...part(ROUTER, [...b, ...c]), "export const extra = 1;"],
    });
    fails({
      [FOO]: [...mounted(), "export const extra = 1;"],
      [BAR]: part(ROUTER, [...b, ...c]),
    });
    // A property of the part's own that came from nowhere.
    fails({
      [FOO]: mounted(),
      [BAR]: part(ROUTER, [
        ...b,
        ...c,
        "  d: protectedProcedure.query(() => 1),",
      ]),
    });
    // A second mount of the same part.
    fails({
      [FOO]: parent(
        [...a, "  bar: barRouter,", "  again: barRouter,"],
        ['import { barRouter } from "./bar";'],
      ),
      [BAR]: part(ROUTER, [...b, ...c]),
    });
  });

  it("fails a procedure changed on the way", () => {
    expect(
      split({
        [FOO]: mounted(),
        [BAR]: part(ROUTER, [
          ...b,
          ...c.map((l) => l.replace("row.amount", "row.amount * 2")),
        ]),
      }),
    ).toMatch(/changed line\(s\)|not whole top-level statements/);
  });

  it("fails procedures reordered in the part", () => {
    expect(
      split({ [FOO]: mounted(), [BAR]: part(ROUTER, [...c, ...b]) }),
    ).toMatch(/changed line\(s\)|not whole top-level statements/);
  });

  it("fails a wrapper or a mount that does more", () => {
    const fails = (files: Record<string, string[] | null>) =>
      expect(split(files)).toMatch(
        /changed line\(s\)|not whole top-level statements/,
      );
    fails({
      [FOO]: mounted(),
      [BAR]: part(
        "export const barRouter = withLogging(createTRPCRouter({",
        [...b, ...c],
        "}));",
      ),
    });
    fails({
      [FOO]: mounted(),
      [BAR]: part("export const barRouter: AnyRouter = createTRPCRouter({", [
        ...b,
        ...c,
      ]),
    });
    fails({
      [FOO]: mounted(),
      [BAR]: part(ROUTER, [...b, ...c], "}).interop();"),
    });
    fails({
      [FOO]: mounted("  bar: withAudit(barRouter),"),
      [BAR]: part(ROUTER, [...b, ...c]),
    });
    // A router spread, or a procedures object mounted under a key.
    fails({
      [FOO]: mounted("  ...barRouter,"),
      [BAR]: part(ROUTER, [...b, ...c]),
    });
    fails({
      [FOO]: parent(
        [...a, "  bar: barProcedures,"],
        ['import { barProcedures } from "./bar";'],
      ),
      [BAR]: part(OBJECT, [...b, ...c], "};"),
    });
    // Mounted somewhere other than the literal the procedures left.
    fails({
      [FOO]: parent(
        [...a, "  nested: createTRPCRouter({ bar: barRouter }),"],
        ['import { barRouter } from "./bar";'],
      ),
      [BAR]: part(ROUTER, [...b, ...c]),
    });
  });
});

describe("notAMove: a stage cut from a long function (owner v0.10.3 Q1)", () => {
  let dir: string;
  let cases = 0;
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  const write = (files: Record<string, string[]>) => {
    for (const [file, lines] of Object.entries(files)) {
      const full = path.join(dir, file);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, `${lines.join("\n")}\n`);
    }
  };
  /** The staged change from `base` (committed alone) to `after`. */
  const change = (
    base: Record<string, string[]>,
    after: Record<string, string[]>,
  ) => {
    cases += 1;
    git("checkout", "-q", "-f", "--orphan", `case-${cases}`);
    git("read-tree", "--empty");
    git("clean", "-qfdx");
    write(base);
    git("add", "-A");
    git("commit", "-q", "-m", "base");
    write(after);
    git("add", "-A");
    return [
      parseNumstat(git("diff", "--cached", "-M", "--numstat")),
      git("diff", "--cached", "-M", "-U1000000"),
    ] as const;
  };
  const cut = (
    base: Record<string, string[]>,
    after: Record<string, string[]>,
  ) => notAMove(...change(base, after));
  const REFUSED = /changed line\(s\)|not whole top-level statements/;

  const YEAR = "src/lib/pure/engine/year.ts";
  const STAGE = "src/lib/pure/engine/stages/rmd.ts";
  /** The statements the stage takes, as they read in the year function. */
  const rmdRun = [
    "let total = 0;",
    "const byPerson: number[] = [];",
    "for (const person of people) {",
    "  const amount = computeRmd(balances.of(person), ageInYear(person, year));",
    "  if (amount > 0) {",
    "    byPerson.push(amount);",
    "    total += amount;",
    "  }",
    "}",
    "const rmd = roundToCents(total);",
  ];
  const indent = (lines: string[], by = "  ") => lines.map((l) => by + l);
  const yearFile = (body: string[], imports: string[]) => [
    ...imports,
    'import type { Context, Result } from "./types";',
    "",
    "export function runYear(ctx: Context, year: number): Result {",
    "  const { people, balances } = ctx;",
    "  const start = balances.total;",
    "  // The year's RMD, per person.",
    ...indent(body),
    "  // What is left.",
    "  const left = start - rmd;",
    // The stage's own `amount` (in its loop) is another binding.
    "  const amount = left / 2;",
    "  return { rmd, byPerson, left, amount };",
    "}",
  ];
  const RULES =
    'import { ageInYear, computeRmd, roundToCents } from "./rules";';
  const base = { [YEAR]: yearFile(rmdRun, [RULES]) };
  const stageFile = ({
    run = rmdRun,
    params = [
      'people: Context["people"],',
      'balances: Context["balances"],',
      "year: number,",
    ],
    ret = ["", "return { rmd, byPerson };"],
  }: { run?: string[]; params?: string[]; ret?: string[] } = {}) => [
    'import { ageInYear, computeRmd, roundToCents } from "../rules";',
    'import type { Context } from "../types";',
    "",
    "/** The year's RMD, per person. */",
    "export function rmdStage(",
    ...indent(params),
    ") {",
    ...indent(run),
    ...indent(ret).map((l) => (l.trim() === "" ? "" : l)),
    "}",
  ];
  const STAGE_IMPORT = 'import { rmdStage } from "./stages/rmd";';
  const after = (
    call = "const { rmd, byPerson } = rmdStage(people, balances, year);",
    stage = stageFile(),
  ) => ({
    [YEAR]: yearFile([call], [STAGE_IMPORT]),
    [STAGE]: stage,
  });

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-stage-cut-"));
    git("init", "-q", "-b", "main");
    git("config", "user.email", "t@example.invalid");
    git("config", "user.name", "Test");
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("passes statements moved in order into a stage, called with a destructure of what it returns", () => {
    expect(cut(base, after())).toBeUndefined();
    const moves = structuralMoves(...change(base, after()));
    expect(moves.stages).toEqual([
      {
        from: YEAR,
        to: STAGE,
        start: { line: 3, character: 0 },
        name: "rmdStage",
        // The call; the signature (5 lines), the blank line, return and `}`.
        wrapper: { old: 1, new: 8 },
        body: { old: rmdRun.length, new: rmdRun.length },
        bodyCode: { old: rmdRun.length, new: rmdRun.length },
        statements: 4,
        returned: ["rmd", "byPerson"],
      },
    ]);
    expect(moves.bodies).toEqual([]);
  });

  it("passes a stage that returns nothing, called as a statement", () => {
    const logged = [
      'import { record } from "./log";',
      "",
      "export function runYear(ctx: Context, year: number): number {",
      "  const total = ctx.total * 2;",
      ...indent(["record(ctx.log, year, total);", "ctx.seen.add(year);"]),
      "  return total;",
      "}",
    ];
    const stage = [
      'import { record } from "../log";',
      "",
      "export function logStage(ctx: Context, year: number, total: number) {",
      "  record(ctx.log, year, total);",
      "  ctx.seen.add(year);",
      "}",
    ];
    expect(
      cut(
        { [YEAR]: logged },
        {
          [YEAR]: [
            'import { logStage } from "./stages/log";',
            ...logged.slice(1, 4),
            "  logStage(ctx, year, total);",
            ...logged.slice(6),
          ],
          "src/lib/pure/engine/stages/log.ts": stage,
        },
      ),
    ).toBeUndefined();
  });

  it("fails a statement reordered on the way", () => {
    const run = [rmdRun[1]!, rmdRun[0]!, ...rmdRun.slice(2)];
    expect(cut(base, after(undefined, stageFile({ run })))).toMatch(REFUSED);
  });

  it("fails a line edited on the way, or a variable renamed", () => {
    const edited = rmdRun.map((l) => l.replace("+= amount", "+= amount * 2"));
    expect(cut(base, after(undefined, stageFile({ run: edited })))).toMatch(
      REFUSED,
    );
    const renamed = rmdRun.map((l) => l.replace(/\btotal\b/g, "sum"));
    expect(cut(base, after(undefined, stageFile({ run: renamed })))).toMatch(
      REFUSED,
    );
  });

  it("fails a new branch in the stage", () => {
    const branched = [
      "if (people.length === 0) total = -1;",
      ...rmdRun.slice(1),
    ];
    expect(
      cut(
        base,
        after(undefined, stageFile({ run: [rmdRun[0]!, ...branched] })),
      ),
    ).toMatch(REFUSED);
    // A new branch at the call.
    expect(
      cut(base, {
        ...after(),
        [YEAR]: yearFile(
          [
            "if (year < 0) throw new Error();",
            "const { rmd, byPerson } = rmdStage(people, balances, year);",
          ],
          [STAGE_IMPORT],
        ),
      }),
    ).toMatch(REFUSED);
  });

  it("fails a stage that leaves out a name the rest reads, or reads one it isn't passed", () => {
    expect(
      cut(
        base,
        after(
          "const { rmd } = rmdStage(people, balances, year);",
          stageFile({ ret: ["", "return { rmd };"] }),
        ),
      ),
    ).toMatch(REFUSED);
    expect(
      cut(
        base,
        after(
          "const { rmd, byPerson } = rmdStage(people, balances);",
          stageFile({
            params: [
              'people: Context["people"],',
              'balances: Context["balances"],',
            ],
          }),
        ),
      ),
    ).toMatch(REFUSED);
  });

  it("fails a call that does more than call, or passes another name", () => {
    expect(
      cut(
        base,
        after(
          "const { rmd, byPerson } = rmdStage(people, balances, year + 1);",
        ),
      ),
    ).toMatch(REFUSED);
    expect(
      cut(
        base,
        after(
          "const { rmd, byPerson } = rmdStage(people, ctx.balances, year);",
        ),
      ),
    ).toMatch(REFUSED);
    expect(
      cut(
        base,
        after(
          "const { rmd, byPerson: rmdByPerson } = rmdStage(people, balances, year);",
        ),
      ),
    ).toMatch(REFUSED);
  });

  it("fails a stage that would write or capture a copy of the function's own variable", () => {
    const fn = (body: string[]) => [
      "export function runYear(ctx: Context, year: number): number {",
      "  let spent = ctx.spent;",
      ...indent(body),
      "  return spent;",
      "}",
    ];
    const stage = (params: string, body: string[], ret: string) => ({
      "src/lib/pure/engine/stages/spend.ts": [
        `export function spendStage(${params}) {`,
        ...indent(body),
        ...(ret ? [`  ${ret}`] : []),
        "}",
      ],
    });
    // It assigns `spent`, which the function reads after it.
    const assigns = ["spent += year;"];
    expect(
      cut(
        { [YEAR]: fn([...assigns, "ctx.log(spent);"]) },
        {
          [YEAR]: [
            'import { spendStage } from "./stages/spend";',
            "",
            ...fn(["spendStage(spent, year);", "ctx.log(spent);"]),
          ],
          ...stage("spent: number, year: number", assigns, ""),
        },
      ),
    ).toMatch(REFUSED);
    // A function it creates reads `spent`, which the function changes later.
    const captures = ["const read = () => spent;"];
    expect(
      cut(
        { [YEAR]: fn([...captures, "spent += year;", "ctx.log(read());"]) },
        {
          [YEAR]: [
            'import { spendStage } from "./stages/spend";',
            "",
            ...fn([
              "const { read } = spendStage(spent);",
              "spent += year;",
              "ctx.log(read());",
            ]),
          ],
          ...stage("spent: number", captures, "return { read };"),
        },
      ),
    ).toMatch(REFUSED);
    // It returns from the function.
    const returns = ["if (year < 0) return 0;"];
    expect(
      cut(
        { [YEAR]: fn([...returns, "ctx.log(spent);"]) },
        {
          [YEAR]: [
            'import { spendStage } from "./stages/spend";',
            "",
            ...fn(["spendStage(year);", "ctx.log(spent);"]),
          ],
          ...stage("year: number", returns, ""),
        },
      ),
    ).toMatch(REFUSED);
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

  it("leaves the generated router catalog to docs:verify-api", () => {
    const catalog = (name: string) =>
      file(name, [
        "-**12 procedures across 1 routers.**",
        "+**12 procedures across 2 routers.**",
        "-## `perf`",
        "+## `perf/summary`",
      ]);
    expect(
      notAMove(renamed, catalog("docs/API_ROUTERS.md").join("\n")),
    ).toBeUndefined();
    expect(notAMove(renamed, catalog("docs/DESIGN.md").join("\n"))).toMatch(
      /neither imports nor path rewrites/,
    );
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
