/**
 * Owner Q2: a `Mechanical:` commit with `Rename:` is proven when every
 * changed code line is its old line with the listed names renamed.
 */
import { describe, expect, it } from "vitest";
import {
  notARename,
  parseNumstat,
  readRenames,
} from "../../scripts/check-commit";

type Change = { file: string; old: string; new: string };

/** A full-context diff of whole files, as `git show -U1000000` gives it. */
const diffOf = (changes: Change[]) =>
  changes
    .map(
      (c) =>
        `diff --git a/${c.file} b/${c.file}\n--- a/${c.file}\n+++ b/${c.file}\n@@ -1 +1 @@\n` +
        [
          ...c.old.split("\n").map((l) => `-${l}`),
          ...c.new.split("\n").map((l) => `+${l}`),
        ].join("\n"),
    )
    .join("\n");

const shapes = {
  keys: new Set(["annualReturnPct", "retirementAge"]),
  isShapeFile: (f: string) => f === "src/lib/db/json-schemas.ts",
};

const prove = (changes: Change[], trailer = "Rename: retAge → retirementAge") =>
  notARename(
    parseNumstat(changes.map((c) => `1\t1\t${c.file}`).join("\n")),
    diffOf(changes),
    `refactor: x\n\nWhy.\n\nMechanical: rename\n${trailer}\n`,
    shapes,
  );

const card = (name: string) => `export function figures(settings: S) {
  // The plan's last working year.
  const ${name} = settings.retirementAge;
  const years = Math.max(0, ${name} - 40);
  return { years, ${name} };
}`;

const rows = (
  name: string,
) => `export function Rows({ ${name} }: { ${name}: number }) {
  return <span>yrs {yearOf(${name})}</span>;
}`;

describe("readRenames", () => {
  it("reads pairs from one or more trailers", () => {
    const { map, problems } = readRenames(
      "x: y\n\nWhy.\n\nRename: retAge → retirementAge, mc -> simulation\nRename: wd → withdrawal\n",
    );
    expect(problems).toEqual([]);
    expect([...map]).toEqual([
      ["retAge", "retirementAge"],
      ["mc", "simulation"],
      ["wd", "withdrawal"],
    ]);
  });

  it("refuses a malformed pair and a name renamed twice", () => {
    expect(
      readRenames("x\n\nRename: a.b → c, d → e, d → f\n").problems,
    ).toEqual([
      '"Rename: a.b → c": write Rename: <old> → <new>',
      "Rename: d is renamed twice",
    ]);
  });
});

describe("notARename", () => {
  it("passes a real rename across files, a variable, a prop and a key", () => {
    expect(
      prove([
        {
          file: "src/a/card.ts",
          old: card("retAge"),
          new: card("retirementAge"),
        },
        {
          file: "src/a/rows.tsx",
          old: rows("retAge"),
          new: rows("retirementAge"),
        },
      ]),
    ).toBeUndefined();
  });

  it("passes the lines prettier re-wraps around a longer name", () => {
    const old = `const total = sum(retAge, other);`;
    const now = `const total = sum(\n  retirementAge,\n  other,\n);`;
    expect(prove([{ file: "src/a.ts", old, new: now }])).toBeUndefined();
  });

  it("fails a renamed string literal", () => {
    expect(
      prove([
        {
          file: "src/a.ts",
          old: `const retAge = 1;\nconst label = "retAge";`,
          new: `const retirementAge = 1;\nconst label = "retirementAge";`,
        },
      ]),
    ).toBe(
      `src/a.ts:2: ""retAge"" → ""retirementAge"" changes a string, not a name`,
    );
  });

  it("fails renamed JSX text", () => {
    expect(
      prove([
        {
          file: "src/a/rows.tsx",
          old: rows("retAge"),
          new: rows("retirementAge").replace("yrs", "years"),
        },
      ]),
    ).toBe(`src/a/rows.tsx:2: "yrs " → "years " changes a string, not a name`);
  });

  it("fails an identifier the list doesn't map", () => {
    expect(
      prove([
        {
          file: "src/a/card.ts",
          old: card("retAge"),
          new: card("retirementAge").replaceAll("years", "yearsLeft"),
        },
      ]),
    ).toBe("src/a/card.ts:4: years → yearsLeft is not in the Rename: list");
  });

  it("fails a renamed comment", () => {
    expect(
      prove([
        {
          file: "src/a/card.ts",
          old: card("retAge"),
          new: card("retirementAge").replace("last working", "retirementAge"),
        },
      ]),
    ).toBe(
      "src/a/card.ts: a comment changed (a rename changes code only; reword comments in their own commit)",
    );
  });

  it("fails a renamed z.object key", () => {
    const schema = (k: string) =>
      `export const input = z.object({ ${k}: z.number() });`;
    expect(
      prove([
        {
          file: "src/lib/x.ts",
          old: schema("retAge"),
          new: schema("retirementAge"),
        },
      ]),
    ).toBe("src/lib/x.ts:1: retAge as a key: a z.object key is a parsed shape");
  });

  it("fails an object key a router returns", () => {
    const router = (k: string) =>
      `export const r = createTRPCRouter({\n  get: p.query(() => ({ ${k}: 65 })),\n});`;
    expect(
      prove([
        {
          file: "src/server/routers/plan.ts",
          old: router("retAge"),
          new: router("retirementAge"),
        },
      ]),
    ).toBe(
      "src/server/routers/plan.ts:2: retAge as a key: a router's object key can be its input or output",
    );
  });

  it("fails a stored or response key anywhere, and a key in a shape file", () => {
    const read = (k: string) => `const r = row.${k};`;
    expect(
      prove(
        [
          {
            file: "src/lib/a.ts",
            old: read("annualReturnPct"),
            new: read("annualReturn"),
          },
        ],
        "Rename: annualReturnPct → annualReturn",
      ),
    ).toBe(
      "src/lib/a.ts:1: annualReturnPct as a key: annualReturnPct is a stored, external or response key (scripts/gen-abbreviation-carve-outs.ts reads them)",
    );
    const field = (k: string) => `export const s = { ${k}: 1 };`;
    expect(
      prove([
        {
          file: "src/lib/db/json-schemas.ts",
          old: field("retAge"),
          new: field("retirementAge"),
        },
      ]),
    ).toBe(
      "src/lib/db/json-schemas.ts:1: retAge as a key: src/lib/db/json-schemas.ts defines a stored shape",
    );
  });

  it("passes a stored key's name as a plain variable", () => {
    expect(
      prove(
        [
          {
            file: "src/lib/a.ts",
            old: "const annualReturnPct = 1;\nuse(annualReturnPct);",
            new: "const annualReturn = 1;\nuse(annualReturn);",
          },
        ],
        "Rename: annualReturnPct → annualReturn",
      ),
    ).toBeUndefined();
  });

  it("fails code added beside the rename, a moved file and an unused pair", () => {
    expect(
      prove([
        {
          file: "src/a.ts",
          old: "const retAge = 1;",
          new: "const retirementAge = 1;\nlog();",
        },
      ]),
    ).toBe("src/a.ts:2: code added or removed");
    expect(
      notARename(
        parseNumstat("1\t1\tsrc/{a.ts => b.ts}"),
        "",
        "x\n\nRename: retAge → retirementAge\n",
        shapes,
      ),
    ).toBe(
      "a Rename: commit moves no file (move it in its own Mechanical: commit)",
    );
    expect(
      prove(
        [
          {
            file: "src/a.ts",
            old: "const retAge = 1;",
            new: "const retirementAge = 1;",
          },
        ],
        "Rename: retAge → retirementAge, wd → withdrawal",
      ),
    ).toBe("Rename: wd renamed nowhere in this commit");
  });

  it("lets the register's references follow, and refuses other prose", () => {
    const register = (n: string) => `| CALC-01 | \`lib/pure/a.ts:${n}\` | H |`;
    expect(
      prove(
        [
          {
            file: "src/lib/pure/a.ts",
            old: "export const calc = 1;",
            new: "export const calculate = 1;",
          },
          {
            file: "docs/CALCULATIONS.md",
            old: register("calc"),
            new: register("calculate"),
          },
        ],
        "Rename: calc → calculate",
      ),
    ).toBeUndefined();
    // A longer name re-pads the table: padding and the rule row may change.
    const table = (n: string, width: number) =>
      [
        `| Id      | ${"Function".padEnd(width)} |`,
        `| ------- | ${"-".repeat(width)} |`,
        `| CALC-01 | ${`\`lib/pure/a.ts:${n}\``.padEnd(width)} |`,
        `| CALC-02 | ${"`lib/pure/b.ts:other`".padEnd(width)} |`,
      ].join("\n");
    expect(
      prove(
        [
          {
            file: "src/lib/pure/a.ts",
            old: "export const calc = 1;",
            new: "export const calculate = 1;",
          },
          {
            file: "docs/CALCULATIONS.md",
            old: table("calc", 21),
            new: table("calculate", 26),
          },
        ],
        "Rename: calc → calculate",
      ),
    ).toBeUndefined();
    expect(
      prove(
        [
          {
            file: "src/lib/pure/a.ts",
            old: "export const calc = 1;",
            new: "export const calculate = 1;",
          },
          {
            file: "docs/CALCULATIONS.md",
            old: table("calc", 21),
            new: table("calculate", 26).replace("other", "another"),
          },
        ],
        "Rename: calc → calculate",
      ),
    ).toBe(
      "docs/CALCULATIONS.md: a changed line is more than the renamed names",
    );
    expect(
      prove([
        {
          file: "src/a.ts",
          old: "const retAge = 1;",
          new: "const retirementAge = 1;",
        },
        { file: "docs/RULES.md", old: "retAge", new: "retirementAge" },
      ]),
    ).toBe(
      "docs/RULES.md: a Rename: commit changes code and the register only",
    );
  });
});
