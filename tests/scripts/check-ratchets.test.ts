import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  baselineRises,
  checkRatchets,
  trailerScopes,
  unexcused,
  type Commit,
} from "../../scripts/check-ratchets";
import {
  bundleRises,
  coverageRises,
  listRises,
} from "../../scripts/ratchets/code-limits";
import {
  registerRises,
  sizeRises,
  suppressionRises,
} from "../../scripts/ratchets/counts";
import {
  attributeMoves,
  groupsOf,
  parseDiff,
  type FileDiff,
} from "../../scripts/ratchets/moves";

const lines = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => `const ${prefix}${i} = compute(${i});`);
const diffs = (entries: Record<string, Partial<FileDiff>>) =>
  new Map(
    Object.entries(entries).map(([f, d]) => [
      f,
      { added: d.added ?? [], deleted: d.deleted ?? [] },
    ]),
  );
const alone = (f: string) => f;
const texts = (rises: { text: string }[]) => rises.map((r) => r.text);

describe("parseDiff", () => {
  it("reads added and deleted lines per file, a deleted '-- ' line included", () => {
    const parsed = parseDiff(
      [
        "diff --git a/a.ts b/a.ts",
        "--- a/a.ts",
        "+++ b/a.ts",
        "@@ -1 +1 @@",
        "--- a SQL comment",
        "+new line",
        "diff --git a/b.ts b/b.ts",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/b.ts",
        "@@ -0,0 +1 @@",
        "+++ counted",
      ].join("\n"),
    );
    expect(parsed.get("a.ts")).toEqual({
      added: ["new line"],
      deleted: ["-- a SQL comment"],
    });
    expect(parsed.get("b.ts")).toEqual({ added: ["++ counted"], deleted: [] });
  });
});

describe("attributeMoves", () => {
  it("joins a moved file and each part of a split to the file they left", () => {
    const old = [...lines("a", 10), ...lines("b", 10)];
    const moves = attributeMoves(
      diffs({
        "src/old.ts": { deleted: old },
        "src/part-a.ts": { added: lines("a", 10) },
        "src/part-b.ts": { added: [...lines("b", 10), "import x from 'y';"] },
        "src/unrelated.ts": { added: lines("z", 10) },
      }),
    );
    expect(Object.fromEntries(moves)).toEqual({
      "src/part-a.ts": "src/old.ts",
      "src/part-b.ts": "src/old.ts",
    });
  });

  it("leaves a file joined to nothing when under half its lines left one file", () => {
    const moves = attributeMoves(
      diffs({
        "src/old.ts": { deleted: lines("a", 4) },
        "src/new.ts": { added: [...lines("a", 4), ...lines("n", 5)] },
        "src/short.ts": { added: ["x = 1;", "}", "import a from 'b';"] },
      }),
    );
    expect(moves.size).toBe(0);
  });

  it("takes git's rename over the line match", () => {
    const moves = attributeMoves(
      diffs({ "src/a.ts": { deleted: ["x"] }, "src/b.ts": { added: ["x"] } }),
      new Map([["src/b.ts", "src/a.ts"]]),
    );
    expect(moves.get("src/b.ts")).toBe("src/a.ts");
  });

  it("groups chained moves together", () => {
    const group = groupsOf(
      new Map([
        ["b", "a"],
        ["c", "b"],
      ]),
    );
    expect(new Set([group("a"), group("b"), group("c")]).size).toBe(1);
    expect(group("d")).toBe("d");
  });
});

describe("sizeRises", () => {
  const split = groupsOf(
    new Map([
      ["src/r/a.ts", "src/r.ts"],
      ["src/r/b.ts", "src/r.ts"],
    ]),
  );

  it("passes an unchanged or lowered baseline and fails a raised entry", () => {
    const base = { files: { "src/x.ts": 500 }, functions: {} };
    expect(sizeRises(base, base, alone)).toEqual([]);
    expect(
      sizeRises(base, { files: { "src/x.ts": 450 }, functions: {} }, alone),
    ).toEqual([]);
    expect(
      texts(
        sizeRises(base, { files: { "src/x.ts": 501 }, functions: {} }, alone),
      ),
    ).toEqual(["files src/x.ts: 501 recorded lines, 500 at the base"]);
  });

  it("fails a new file recorded over the limit, not one under it", () => {
    const base = { files: {}, functions: {} };
    expect(
      sizeRises(base, { files: { "src/n.ts": 390 }, functions: {} }, alone),
    ).toEqual([]);
    expect(
      sizeRises(base, { files: { "src/n.ts": 420 }, functions: {} }, alone),
    ).toHaveLength(1);
  });

  it("reads a split as a redistribution: parts over 400 within the old entry", () => {
    const base = {
      files: { "src/r.ts": 1000 },
      functions: { "src/r.ts": { "r.big": 300, "r.other": 200 } },
    };
    const head = {
      files: { "src/r/a.ts": 600, "src/r/b.ts": 380 },
      functions: {
        "src/r/a.ts": { "a.big": 300 },
        "src/r/b.ts": { "b.other": 190 },
      },
    };
    expect(sizeRises(base, head, split)).toEqual([]);
    const over = { ...head, files: { "src/r/a.ts": 600, "src/r/b.ts": 450 } };
    expect(texts(sizeRises(base, over, split))).toEqual([
      "files src/r/a.ts, src/r/b.ts: 1050 recorded lines, 1000 at the base",
    ]);
  });

  it("fails a function that grows when it moves", () => {
    const base = { files: {}, functions: { "src/r.ts": { "r.big": 300 } } };
    const head = { files: {}, functions: { "src/r/a.ts": { "a.big": 301 } } };
    expect(sizeRises(base, head, split)).toHaveLength(1);
    expect(sizeRises(base, head, alone)).toHaveLength(1);
  });

  it("fails a new long function in an unjoined file", () => {
    const base = { files: {}, functions: {} };
    const head = { files: {}, functions: { "src/n.ts": { f: 160 } } };
    expect(sizeRises(base, head, alone)).toHaveLength(1);
  });
});

describe("suppressionRises", () => {
  const split = groupsOf(new Map([["src/r/a.ts", "src/r.ts"]]));
  const base = { "src/r.ts": { "max-lines": { count: 3 } } };

  it("fails a count that rises, in a file or a new one", () => {
    expect(
      texts(
        suppressionRises(
          "s.json",
          base,
          { "src/r.ts": { "max-lines": { count: 4 } } },
          alone,
        ),
      ),
    ).toEqual(["max-lines in src/r.ts: 4, 3 at the base"]);
    expect(
      suppressionRises(
        "s.json",
        base,
        { ...base, "src/n.ts": { "no-x": { count: 1 } } },
        alone,
      ),
    ).toHaveLength(1);
  });

  it("passes counts handed out over the parts of a split, per rule", () => {
    const head = {
      "src/r.ts": { "max-lines": { count: 1 } },
      "src/r/a.ts": { "max-lines": { count: 2 } },
    };
    expect(suppressionRises("s.json", base, head, split)).toEqual([]);
    const more = {
      ...head,
      "src/r/a.ts": { "max-lines": { count: 2 }, "no-x": { count: 1 } },
    };
    expect(suppressionRises("s.json", base, more, split)).toHaveLength(1);
  });
});

describe("registerRises", () => {
  const base = {
    risk: { "TAX-01": "H", "TAX-02": "M" },
    highRiskWithoutIndependentTest: ["TAX-01"],
    exportsWithoutRow: ["src/lib/calculators/a.ts:foo"],
  };

  it("passes the same register, a moved export and a raised risk", () => {
    expect(registerRises(base, base)).toEqual([]);
    expect(
      registerRises(base, {
        risk: { "TAX-01": "H", "TAX-02": "H", "TAX-03": "L" },
        highRiskWithoutIndependentTest: [],
        exportsWithoutRow: ["src/lib/pure/a.ts:foo"],
      }),
    ).toEqual([]);
  });

  it("fails a lowered risk, a new high-risk row and a new export", () => {
    expect(
      texts(
        registerRises(base, {
          risk: { "TAX-01": "M", "TAX-02": "M" },
          highRiskWithoutIndependentTest: ["TAX-01", "TAX-02"],
          exportsWithoutRow: ["src/lib/calculators/a.ts:foo", "src/b.ts:bar"],
        }),
      ),
    ).toEqual([
      "TAX-01: risk H → M",
      "TAX-02: added to highRiskWithoutIndependentTest",
      "src/b.ts:bar: added to exportsWithoutRow",
    ]);
  });
});

describe("bundleRises", () => {
  const file = (pages: string, fallback = 460, chunk = 500) =>
    `const PAGE_BUDGET_KB: Record<string, number> = {\n${pages}\n};\nconst DEFAULT_PAGE_BUDGET_KB = ${fallback};\nconst CHUNK_ERROR_KB = ${chunk};\n`;
  const base = file(
    `  "/(dashboard)/a/page": 300,\n  "/(dashboard)/b/page": 200,`,
  );
  const pages = new Set(["src/app/(dashboard)/a/page.tsx"]);
  const tree = (f: string) => (pages.has(f) ? "x" : undefined);

  it("passes lowered budgets and a removed page's entry", () => {
    expect(
      bundleRises(base, file(`  "/(dashboard)/a/page": 290,`), tree),
    ).toEqual([]);
  });

  it("fails a raised budget, default or chunk limit, and a dropped live page", () => {
    expect(
      texts(
        bundleRises(
          base,
          file(
            `  "/(dashboard)/b/page": 201,\n  "/(dashboard)/c/page": 470,`,
            461,
            501,
          ),
          tree,
        ),
      ),
    ).toEqual([
      "DEFAULT_PAGE_BUDGET_KB 460 → 461",
      "CHUNK_ERROR_KB 500 → 501",
      "/(dashboard)/a/page: budget 300 → 461 KB",
      "/(dashboard)/b/page: budget 200 → 201 KB",
      "/(dashboard)/c/page: new budget 470 KB, over the default 460",
    ]);
  });
});

describe("coverageRises", () => {
  const config = (t: string, exclude: string) =>
    `export default { test: { coverage: { exclude: [${exclude}], thresholds: { ${t} } } } };`;
  const base = config(`lines: 85, branches: 70`, `"src/a.ts"`);

  it("passes raised thresholds, new keys and a moved exclude", () => {
    expect(
      coverageRises(
        base,
        config(
          `lines: 90, branches: 70, "src/lib/pure/**": { lines: 95 }`,
          `"src/b.ts"`,
        ),
        new Map([["src/b.ts", "src/a.ts"]]),
      ),
    ).toEqual([]);
  });

  it("fails a lowered or removed threshold and a new exclude", () => {
    expect(
      texts(
        coverageRises(
          base,
          config(`lines: 80`, `"src/a.ts", "src/c.ts"`),
          new Map(),
        ),
      ),
    ).toEqual([
      "coverage threshold lines: 85 → 80",
      "coverage threshold branches: 70 → removed",
      "coverage exclude added: src/c.ts",
    ]);
  });
});

describe("listRises", () => {
  const base = `
const EXEMPT: Record<string, string> = { "src/a.ts": "reason" };
const SITES_KNOWN: Record<string, { count: number; reason: string }> = (() => {
  const reason = "why";
  return { "src/r.ts": { count: 3, reason } };
})();
const BUILT_AT_LOAD = ["src/r.ts schemaA"];
const KNOWN_GAPS: Record<string, string[]> = { "*/x.list": ["unordered"] };
function findX() {
  return scan(/x/, "rule", { additionalExempt: new Set(["src/f.ts"]) });
}
`;
  const moves = new Map([
    ["src/r/a.ts", "src/r.ts"],
    ["src/r/b.ts", "src/r.ts"],
  ]);

  it("passes the same lists and entries whose file moved or split", () => {
    expect(listRises("v.ts", base, base, new Map())).toEqual([]);
    const moved = base
      .replace(
        `{ "src/r.ts": { count: 3, reason } }`,
        `{ "src/r/a.ts": { count: 2, reason }, "src/r/b.ts": { count: 1, reason } }`,
      )
      .replace(`["src/r.ts schemaA"]`, `["src/r/b.ts schemaA"]`);
    expect(listRises("v.ts", base, moved, moves)).toEqual([]);
  });

  it("fails every kind of growth", () => {
    const grown = base
      .replace(
        `"src/a.ts": "reason"`,
        `"src/a.ts": "reason", "src/n.ts": "new"`,
      )
      .replace(`count: 3`, `count: 4`)
      .replace(
        `["src/r.ts schemaA"]`,
        `["src/r.ts schemaA", "src/r.ts schemaB"]`,
      )
      .replace(`["unordered"]`, `["unordered", "money"]`)
      .replace(`new Set(["src/f.ts"])`, `new Set(["src/f.ts", "src/g.ts"])`);
    expect(texts(listRises("v.ts", base, grown, new Map()))).toEqual([
      "EXEMPT › src/n.ts: added",
      "BUILT_AT_LOAD › src/r.ts schemaB: added",
      "KNOWN_GAPS › */x.list › money: added",
      "findX.additionalExempt › src/g.ts: added",
      "SITES_KNOWN › src/r.ts: 3 → 4",
    ]);
  });
});

describe("trailers", () => {
  const commit = (message: string, files: string[]): Commit => ({
    sha: "abcdef1234",
    message,
    files,
  });

  it("reads files and globs before the reason, and reports a missing reason", () => {
    expect(
      trailerScopes(
        "x\n\nRatchet-raise: a.json, b.json — owner OK 2026-11-04\nRatchet-raise: c.json\n",
        "Ratchet-raise",
      ),
    ).toEqual({
      scopes: ["a.json", "b.json"],
      problems: [
        `"Ratchet-raise: c.json": write Ratchet-raise: <file> — <reason>`,
      ],
    });
  });

  it("excuses a raise only from a commit that changes the file", () => {
    const rise = [{ file: "size-baseline.json", text: "x" }];
    const trailer =
      "chore: raise\n\nRatchet-raise: size-baseline.json — owner OK";
    expect(unexcused(rise, [commit(trailer, ["size-baseline.json"])])).toEqual(
      [],
    );
    expect(unexcused(rise, [commit(trailer, ["src/a.ts"])])).toEqual(rise);
    expect(
      unexcused(rise, [commit("chore: x\n\nbody", ["size-baseline.json"])]),
    ).toEqual(rise);
  });

  it("excuses a re-recorded baseline file matched by the trailer's glob", () => {
    const file = "tests/baseline/__baseline__/el-h1/paycheck.json";
    const rerecord = (scope: string) =>
      commit(`refactor: x\n\nBaseline-rerecord: ${scope} — owner-signed`, [
        file,
      ]);
    expect(
      baselineRises([file], [rerecord("__baseline__/*/paycheck.json")]),
    ).toEqual([]);
    expect(
      baselineRises([file], [rerecord("tests/baseline/__baseline__/**")]),
    ).toEqual([]);
    expect(baselineRises([file], [rerecord("__sync__/**")])).toHaveLength(1);
  });
});

describe("checkRatchets in a repository", () => {
  let dir: string;
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  };
  const commit = (message: string) => {
    git("add", "-A");
    git("commit", "-q", "-m", message);
    return git("rev-parse", "HEAD");
  };
  const size = (files: Record<string, number>) =>
    JSON.stringify({ files, functions: {} });
  let base: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-ratchets-"));
    git("init", "-q", "-b", "main");
    git("config", "user.email", "t@example.invalid");
    git("config", "user.name", "Test");
    write("src/r.ts", [...lines("a", 300), ...lines("b", 300)].join("\n"));
    write("size-baseline.json", size({ "src/r.ts": 600 }));
    write("tests/baseline/__baseline__/h1/p.json", "{}");
    write("tests/baseline/__baseline__/h1/q.json", "{}");
    base = commit("chore: base");
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("passes a split recorded within the old entry and a deleted baseline file", () => {
    git("checkout", "-q", "-B", "split", base);
    fs.rmSync(path.join(dir, "src/r.ts"));
    write("src/r/a.ts", lines("a", 300).join("\n"));
    write("src/r/b.ts", lines("b", 300).join("\n"));
    write("size-baseline.json", size({ "src/r/a.ts": 300, "src/r/b.ts": 300 }));
    fs.rmSync(path.join(dir, "tests/baseline/__baseline__/h1/q.json"));
    commit("refactor: split r\n\nMechanical: split");
    expect(checkRatchets(base, "HEAD", dir)).toEqual([]);
  });

  it("fails a raise and a changed baseline file until each carries its trailer", () => {
    git("checkout", "-q", "-B", "raise", base);
    write("size-baseline.json", size({ "src/r.ts": 601 }));
    write("tests/baseline/__baseline__/h1/p.json", '{"a":1}');
    commit("chore: raise\n\nBecause.");
    const failures = checkRatchets(base, "HEAD", dir);
    expect(failures).toHaveLength(2);
    expect(failures[0]).toMatch(/size-baseline\.json: files src\/r\.ts: 601/);
    expect(failures[1]).toMatch(
      /__baseline__\/h1\/p\.json: behavior baseline changed/,
    );

    git(
      "commit",
      "-q",
      "--amend",
      "-m",
      "chore: raise\n\nBecause.\n\nRatchet-raise: size-baseline.json — owner OK\nBaseline-rerecord: __baseline__/h1/* — owner-signed",
    );
    expect(checkRatchets(base, "HEAD", dir)).toEqual([]);
  });
});
