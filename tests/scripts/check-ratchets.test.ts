import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  baselineRises,
  checkRatchets,
  trailerScopes,
  type Commit,
} from "../../scripts/check-ratchets";
import { claimsIn, excuse, importLines } from "../../scripts/ratchets/raise";
import type { Rise } from "../../scripts/ratchets/rise";
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

  it("reads a path threshold under the folder it moved to", () => {
    const at = (glob: string, lines: number) =>
      config(`"${glob}": { lines: ${lines} }`, ``);
    const moves = new Map([["src/b/engine/x.ts", "src/a/engine/x.ts"]]);
    expect(
      coverageRises(
        at("src/a/engine/**", 90),
        at("src/b/engine/**", 90),
        moves,
      ),
    ).toEqual([]);
    expect(
      texts(
        coverageRises(
          at("src/a/engine/**", 90),
          at("src/b/engine/**", 85),
          moves,
        ),
      ),
    ).toEqual(["coverage threshold src/a/engine/**.lines: 90 → 85"]);
    expect(
      coverageRises(
        at("src/a/engine/**", 90),
        at("src/b/engine/**", 90),
        new Map(),
      ),
    ).toHaveLength(1);
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
        `"Ratchet-raise: c.json": write Ratchet-raise: <file> — <entry> +<N>, <reason>`,
      ],
    });
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

describe("Ratchet-raise claims", () => {
  const claims = (text: string) =>
    claimsIn(text).map(({ path, n }) => ({ path, n }));

  it("pairs each path with its +N, the reason in parentheses left out", () => {
    expect(
      claims(
        "owner rule of 2026-11-05, import lines only: src/a.ts +43 (moved from src/b.ts, which drops 39; together +4)",
      ),
    ).toEqual([{ path: "src/a.ts", n: 43 }]);
    expect(
      claims(
        "src/a.ts split: parts plus what is left +11 (11 import lines added); src/b.ts: +1 import line",
      ),
    ).toEqual([
      { path: "src/a.ts", n: 11 },
      { path: "src/b.ts", n: 1 },
    ]);
  });

  it("gives an 'each +N' to the paths after it, until one has its own", () => {
    expect(
      claims(
        "+3 import lines each, one import that wraps: components/a.tsx (x); lib/b.ts (y); and +1 import line on server/c.ts",
      ),
    ).toEqual([
      { path: "components/a.tsx", n: 3 },
      { path: "lib/b.ts", n: 3 },
      { path: "server/c.ts", n: 1 },
    ]);
  });

  it("reads `<name> <a> → <b>` as +(b − a)", () => {
    expect(claims("milestones 282 → 284, brokerage 240 → 242 KB")).toEqual([
      { path: undefined, n: 2 },
      { path: undefined, n: 2 },
      { path: undefined, n: undefined },
    ]);
    expect(claims("src/a.ts 870 -> 872")).toEqual([{ path: "src/a.ts", n: 2 }]);
  });
});

describe("excuse", () => {
  const size = (paths: string[], by: number): Rise => ({
    file: "size-baseline.json",
    id: paths.join(),
    text: "t",
    by,
    entry: { paths, names: [] },
    sized: paths,
  });
  const raise = (value: string, body = "Why.") =>
    `refactor: x\n\n${body}\n\nRatchet-raise: ${value}\n`;

  it("passes a trailer naming the entry with at least its rise", () => {
    const rise = size(["src/server/x.ts"], 2);
    expect(
      excuse(rise, raise("size-baseline.json — src/server/x.ts +2, why")),
    ).toMatchObject({ ok: true });
    expect(
      excuse(rise, raise("size-baseline.json — server/x.ts: +3, why")),
    ).toMatchObject({ ok: true });
  });

  it("doesn't excuse one entry by a trailer for another", () => {
    const rise = size(["src/server/x.ts"], 2);
    for (const value of [
      "size-baseline.json — src/server/y.ts +5, why",
      "size-baseline.json — x.ts +5, why",
      "eslint-suppressions.json — src/server/x.ts +5, why",
      "size-baseline.json — owner OK",
    ])
      expect(excuse(rise, raise(value))).toEqual({
        ok: false,
        why: "no Ratchet-raise trailer in this commit names the entry",
      });
  });

  it("fails a +N below the rise", () => {
    expect(
      excuse(
        size(["src/x.ts"], 3),
        raise("size-baseline.json — src/x.ts +2, why"),
      ),
    ).toEqual({
      ok: false,
      why: "its Ratchet-raise trailer gives +2, the entry rose +3",
    });
  });

  it("names a function, a rule or an export by its word beside the path", () => {
    const fn: Rise = {
      ...size(["src/x.tsx"], 1),
      sized: undefined,
      entry: { paths: ["src/x.tsx"], names: [["Card"]] },
    };
    expect(
      excuse(fn, raise("size-baseline.json — x.tsx Card: +1, why")),
    ).toMatchObject({ ok: true });
    expect(
      excuse(fn, raise("size-baseline.json — x.tsx: +1, why")),
    ).toMatchObject({ ok: false });
    const exp: Rise = {
      file: "scripts/calculation-register-baseline.json",
      id: "e",
      text: "t",
      entry: { paths: [], names: [["mapping.ts"], ["isPull"]] },
    };
    const reg = (v: string) =>
      excuse(exp, raise(`scripts/calculation-register-baseline.json — ${v}`));
    expect(reg("sync/mapping.ts:isPull joins the list")).toMatchObject({
      ok: true,
    });
    expect(reg("sync/mapping.ts:isPullOnly joins the list")).toMatchObject({
      ok: false,
    });
  });

  it("reads the body's `- <path> <a> -> <b>` list only when the trailer names no entry", () => {
    const rise = size(["src/x.ts"], 2);
    const body = "Size:\n- src/x.ts 870 -> 872 (+2)\n- src/y.ts 10 -> 11";
    expect(
      excuse(rise, raise("size-baseline.json — import lines (owner 1c)", body)),
    ).toMatchObject({ ok: true });
    expect(
      excuse(rise, raise("size-baseline.json — src/y.ts +1, why", body)),
    ).toMatchObject({ ok: false });
  });
});

describe("importLines", () => {
  it("counts import statements and the lines a type holding import() wraps to", () => {
    const one = `import { a } from "./a";\nconst t = x as import("./b").B | undefined;\n`;
    const wrapped = `import {\n  a,\n  c,\n} from "./a";\nexport type { D } from "./d";\nconst t = x as\n  | import("./b").B\n  | undefined;\n`;
    expect(importLines("f.ts", one)).toEqual({ statements: 1, types: 0 });
    expect(importLines("f.ts", wrapped)).toEqual({ statements: 5, types: 1 });
    expect(importLines("f.json", one)).toEqual({ statements: 0, types: 0 });
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
    expect(checkRatchets(base, "HEAD", dir)).toEqual({
      failures: [],
      excused: [],
    });
  });

  it("fails a raise and a changed baseline file until each carries its trailer", () => {
    git("checkout", "-q", "-B", "raise", base);
    write("size-baseline.json", size({ "src/r.ts": 601 }));
    write("tests/baseline/__baseline__/h1/p.json", '{"a":1}');
    commit("chore: raise\n\nBecause.");
    const { failures } = checkRatchets(base, "HEAD", dir);
    expect(failures).toHaveLength(2);
    expect(failures[0]).toMatch(
      /size-baseline\.json: files src\/r\.ts: 601 .* \(\+1\): no Ratchet-raise trailer in this commit names the entry/,
    );
    expect(failures[1]).toMatch(
      /__baseline__\/h1\/p\.json: behavior baseline changed/,
    );

    git(
      "commit",
      "-q",
      "--amend",
      "-m",
      "chore: raise\n\nBecause.\n\nRatchet-raise: size-baseline.json — src/r.ts +1, owner OK\nBaseline-rerecord: __baseline__/h1/* — owner-signed",
    );
    const report = checkRatchets(base, "HEAD", dir);
    expect(report.failures).toEqual([]);
    expect(report.excused).toHaveLength(1);
  });
  const sha = () => git("rev-parse", "--short=8", "HEAD");
  const rBody = (aCount: number, bFrom = 0) =>
    [...lines("a", aCount), ...lines("b", 300).slice(bFrom)].join("\n");

  it("fails a rise whose trailer is in another commit", () => {
    git("checkout", "-q", "-B", "elsewhere", base);
    write("src/r.ts", rBody(301));
    write("size-baseline.json", size({ "src/r.ts": 601 }));
    commit("chore: grow r\n\nBecause.");
    const raised = sha();
    // The second commit changes size-baseline.json too (formatting only).
    write(
      "size-baseline.json",
      JSON.stringify({ files: { "src/r.ts": 601 }, functions: {} }, null, 2),
    );
    commit(
      "chore: other\n\nBecause.\n\nRatchet-raise: size-baseline.json — src/r.ts +1, owner OK",
    );
    const { failures, excused } = checkRatchets(base, "HEAD", dir);
    expect(excused).toEqual([]);
    expect(failures).toEqual([
      expect.stringMatching(
        new RegExp(
          `^${raised} size-baseline\\.json: files src/r\\.ts: 601 .*names the entry`,
        ),
      ),
    ]);
  });

  it("hands a renamed file's entry to its new path", () => {
    git("checkout", "-q", "-B", "rename", base);
    git("mv", "src/r.ts", "src/q.ts");
    write("size-baseline.json", size({ "src/q.ts": 600 }));
    commit("refactor: r becomes q\n\nMechanical: rename");
    expect(checkRatchets(base, "HEAD", dir)).toEqual({
      failures: [],
      excused: [],
    });
  });

  it("lists every excused rise with its commit, entry, +N and trailer", () => {
    git("checkout", "-q", "-B", "listed", base);
    write("src/r.ts", rBody(301));
    write(
      "size-baseline.json",
      JSON.stringify({
        files: { "src/r.ts": 601 },
        functions: { "src/r.ts": { longFn: 160 } },
      }),
    );
    const trailer =
      "Ratchet-raise: size-baseline.json — src/r.ts +1; src/r.ts longFn +160, owner OK";
    commit(`chore: grow r\n\nBecause.\n\n${trailer}`);
    const { failures, excused } = checkRatchets(base, "HEAD", dir);
    expect(failures).toEqual([]);
    expect(excused).toEqual([
      `${sha()} size-baseline.json: files src/r.ts: 601 recorded lines, 600 at the base (+1), by "${trailer}"`,
      `${sha()} size-baseline.json: functions in src/r.ts: 160 recorded lines (longest 160), 0 (longest 0) at the base (+160), by "${trailer}"`,
    ]);
  });

  it("holds a Mechanical: move into a recorded file to the import lines it adds", () => {
    git("checkout", "-q", "-B", "joined", base);
    write("src/t.ts", lines("t", 450).join("\n"));
    write("size-baseline.json", size({ "src/r.ts": 600, "src/t.ts": 450 }));
    const start = commit("chore: t");
    const imports = [`import { a } from "./a";`, `import { b } from "./b";`];
    write("src/r.ts", rBody(300, 50));
    write(
      "src/t.ts",
      [...imports, ...lines("t", 450), ...lines("b", 50)].join("\n"),
    );
    write("size-baseline.json", size({ "src/r.ts": 550, "src/t.ts": 502 }));
    commit(
      "refactor: b moves to t\n\nMechanical: move\nRatchet-raise: size-baseline.json — src/t.ts +2, its two import lines",
    );
    expect(checkRatchets(start, "HEAD", dir)).toMatchObject({
      failures: [],
      excused: [expect.stringContaining("src/r.ts, src/t.ts")],
    });

    write(
      "src/t.ts",
      [
        ...imports,
        ...lines("t", 450),
        ...lines("b", 50),
        "const extra = 1;",
      ].join("\n"),
    );
    write("size-baseline.json", size({ "src/r.ts": 550, "src/t.ts": 503 }));
    git("add", "-A");
    git(
      "commit",
      "-q",
      "--amend",
      "-m",
      "refactor: b moves to t\n\nMechanical: move\nRatchet-raise: size-baseline.json — src/t.ts +3, why",
    );
    expect(checkRatchets(start, "HEAD", dir).failures).toEqual([
      expect.stringContaining(
        "rose +3 in a Mechanical: commit, which adds 2 import lines across src/r.ts, src/t.ts",
      ),
    ]);
  });

  it("passes a revert back to the entry's value before the reverted commit", () => {
    git("checkout", "-q", "-B", "revert", base);
    write("src/r.ts", rBody(299));
    write("size-baseline.json", size({ "src/r.ts": 599 }));
    commit("chore: shrink r\n\nBecause.");
    git("revert", "--no-edit", "HEAD");
    expect(checkRatchets(base, "HEAD", dir)).toMatchObject({
      failures: [],
      excused: [expect.stringMatching(/\(\+1\), by the revert of [0-9a-f]{8}/)],
    });
  });

  it("checks a merge only for what it raises itself", () => {
    git("checkout", "-q", "-B", "side", base);
    write("src/r.ts", rBody(301));
    write("size-baseline.json", size({ "src/r.ts": 601 }));
    commit(
      "chore: grow r\n\nBecause.\n\nRatchet-raise: size-baseline.json — src/r.ts +1, owner OK",
    );
    git("checkout", "-q", "-B", "trunk", base);
    write("src/other.ts", "export const x = 1;");
    commit("chore: other\n\nBecause.");
    git("merge", "-q", "--no-ff", "--no-edit", "side");
    expect(checkRatchets(base, "HEAD", dir)).toMatchObject({
      failures: [],
      excused: [expect.stringContaining("(+1)")],
    });
    git("reset", "-q", "--hard", "HEAD^");
    git("merge", "-q", "--no-ff", "--no-commit", "side");
    write("size-baseline.json", size({ "src/r.ts": 602 }));
    git("add", "-A");
    git("commit", "-q", "--no-edit");
    expect(checkRatchets(base, "HEAD", dir).failures).toEqual([
      expect.stringMatching(
        /^[0-9a-f]{8} size-baseline\.json: files src\/r\.ts: 602 .*\(\+1\)/,
      ),
    ]);
  });
});

describe("checkRatchets: a body or a router split moved whole (owner Q14)", () => {
  let dir: string;
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  const write = (file: string, lines: string[]) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), `${lines.join("\n")}\n`);
  };
  const filler = Array.from(
    { length: 420 },
    (_, i) => `export const f${i} = compute(${i});`,
  );
  const body = [
    ...Array.from(
      { length: 410 },
      (_, i) => `const v${i} = await load(ctx, input, ${i});`,
    ),
    "return v409;",
  ];
  const ROUTER = "src/r.ts";
  const SERVICE = "src/summary.ts";
  const PART = "src/part.ts";
  const imports = [
    'import { createTRPCRouter, protectedProcedure } from "./trpc";',
    'import { compute, load } from "./lib";',
  ];
  const router = (summary: string[], extraImports: string[] = []) => [
    ...imports,
    ...extraImports,
    "",
    ...filler,
    "",
    "export const rRouter = createTRPCRouter({",
    ...summary,
    "});",
  ];
  const inline = [
    "  summary: protectedProcedure.query(async ({ ctx, input }) => {",
    ...body.map((l) => `    ${l}`),
    "  }),",
  ];
  const service = (inner = body.map((l) => `  ${l}`)) => [
    'import type { Ctx, Input } from "./trpc";',
    'import { load } from "./lib";',
    "",
    "export async function computeSummary(",
    "  ctx: Ctx,",
    "  input: Input,",
    ") {",
    ...inner,
    "}",
  ];
  const count = (file: string) =>
    fs.readFileSync(path.join(dir, file), "utf8").split("\n").length - 1;
  /** size-baseline.json at the files' sizes, with the given function entries. */
  const record = (
    files: string[],
    functions: Record<string, Record<string, number>>,
  ) =>
    write("size-baseline.json", [
      JSON.stringify({
        files: Object.fromEntries(files.map((f) => [f, count(f)])),
        functions,
      }),
    ]);
  const commit = (message: string) => {
    git("add", "-A");
    git("commit", "-q", "-m", message);
    return git("rev-parse", "HEAD");
  };
  let base: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-ratchets-q14-"));
    git("init", "-q", "-b", "main");
    git("config", "user.email", "t@example.invalid");
    git("config", "user.name", "Test");
    write(ROUTER, router(inline));
    record([ROUTER], { [ROUTER]: { "rRouter.summary.query()": 413 } });
    base = commit("chore: base");
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  const movedBody = (inService = service(), fns = { computeSummary: 416 }) => {
    git("checkout", "-q", "-B", "body", base);
    write(
      ROUTER,
      router(
        [
          "  summary: protectedProcedure.query(({ ctx, input }) => computeSummary(ctx, input)),",
        ],
        ['import { computeSummary } from "./summary";'],
      ),
    );
    write(SERVICE, inService);
    record([ROUTER, SERVICE], { [SERVICE]: fns });
    commit(
      `refactor: the summary body moves to a service\n\nMechanical: body moved\nRatchet-raise: size-baseline.json — src/summary.ts +40; src/summary.ts computeSummary +4, its signature`,
    );
  };

  it("passes a body moved whole: imports, signature, brace and call, and its function entry taken over", () => {
    movedBody();
    const report = checkRatchets(base, "HEAD", dir);
    expect(report.failures).toEqual([]);
    expect(report.excused).toEqual([
      expect.stringContaining("files src/r.ts, src/summary.ts"),
      expect.stringContaining(
        "functions in src/summary.ts: 416 recorded lines (longest 416), 413",
      ),
    ]);
  });

  it("fails a body move with an extra line", () => {
    movedBody([...service(), "export const extra = 1;"]);
    expect(checkRatchets(base, "HEAD", dir).failures).toEqual([
      expect.stringContaining(
        "the code lines left across src/r.ts, src/summary.ts change by 4, their import lines by 3",
      ),
    ]);
  });

  it("fails a body with a statement changed: no move, so only imports", () => {
    movedBody(
      service(body.map((l) => `  ${l.replace("input, 7)", "input, 8)")}`)),
    );
    const { failures } = checkRatchets(base, "HEAD", dir);
    expect(failures).toHaveLength(2);
    expect(failures[0]).toMatch(/which adds 3 import lines/);
    expect(failures[1]).toMatch(
      /functions in src\/summary\.ts: 416 .*adds 0 lines of import/,
    );
  });

  it("fails a moved function longer than the arrow it left plus its signature", () => {
    // A blank line inside: the code lines balance, the function entry doesn't.
    const inner = body.map((l) => `  ${l}`);
    movedBody(service([...inner.slice(0, 5), "", ...inner.slice(5)]), {
      computeSummary: 417,
    });
    expect(checkRatchets(base, "HEAD", dir).failures).toEqual([
      expect.stringContaining(
        "src/summary.ts computeSummary(): 417, rRouter.summary.query() 413 +3 for its signature",
      ),
    ]);
  });

  const procs = (from: number, to: number) =>
    Array.from({ length: to - from }, (_, k) => {
      const i = from + k;
      return [
        `  p${i}: protectedProcedure.query(async ({ ctx }) => {`,
        `    const rows = await load(ctx, ${i});`,
        "    return rows.length;",
        "  }),",
      ];
    }).flat();
  let longRouter = "";
  const split = (partLines: string[], keep = procs(0, 110)) => {
    git("checkout", "-q", "-B", "split", longRouter);
    write(ROUTER, [
      ...imports,
      'import { partRouter } from "./part";',
      "",
      "export const rRouter = createTRPCRouter({",
      ...keep,
      "  part: partRouter,",
      "});",
    ]);
    write(PART, partLines);
    record([ROUTER, PART], {});
    commit(
      "refactor: r splits\n\nMechanical: split\nRatchet-raise: size-baseline.json — src/part.ts +20, its wrapper and mount",
    );
  };
  const part = (
    open = "export const partRouter = createTRPCRouter({",
    props = procs(110, 220),
    close = "});",
  ) => [...imports, "", open, ...props, close];

  it("passes a router split: imports, the part's wrapper and its mount", () => {
    git("checkout", "-q", "-B", "split-base", base);
    write(ROUTER, [
      ...imports,
      "",
      "export const rRouter = createTRPCRouter({",
      ...procs(0, 220),
      "});",
    ]);
    record([ROUTER], {});
    const start = commit("chore: a long router");
    longRouter = start;
    split(part());
    const report = checkRatchets(start, "HEAD", dir);
    expect(report.failures).toEqual([]);
    expect(report.excused).toEqual([
      expect.stringContaining("files src/part.ts, src/r.ts"),
    ]);

    // An extra line in the part.
    split([...part(), "export const extra = 1;"]);
    expect(checkRatchets(start, "HEAD", dir).failures).toEqual([
      expect.stringContaining("change by 4, their import lines by 3"),
    ]);
    // Procedures reordered on the way: no split, so only imports.
    split(part(undefined, [...procs(111, 220), ...procs(110, 111)]));
    expect(checkRatchets(start, "HEAD", dir).failures).toEqual([
      expect.stringMatching(/which adds 3 import lines/),
    ]);
    // A wrapper that does more.
    split(
      part(
        "export const partRouter = withLogging(createTRPCRouter({",
        undefined,
        "}));",
      ),
    );
    expect(checkRatchets(start, "HEAD", dir).failures).toEqual([
      expect.stringMatching(/which adds 3 import lines/),
    ]);
  });

  const YEAR = "src/year.ts";
  const STAGE = "src/stage.ts";
  const vs = (from: number, to: number, edit = (l: string) => l) =>
    Array.from({ length: to - from }, (_, k) =>
      edit(`const v${from + k} = load(a, ${from + k});`),
    );
  const yearFn = (inner: string[], extraImports: string[] = []) => [
    'import { load } from "./lib";',
    ...extraImports,
    "",
    "export function runYear(ctx: { a: number }) {",
    "  const a = ctx.a;",
    ...inner.map((l) => `  ${l}`),
    "  return v449 + v899;",
    "}",
  ];
  let longYear = "";
  const staged = (
    stageBody = vs(0, 450).map((l) => `  ${l}`),
    vStage = 454,
  ) => {
    git("checkout", "-q", "-B", "stage", longYear);
    write(
      YEAR,
      yearFn(
        ["const { v449 } = vStage(a);", ...vs(450, 900)],
        ['import { vStage } from "./stage";'],
      ),
    );
    write(STAGE, [
      'import { load } from "./lib";',
      "",
      "export function vStage(a: number) {",
      ...stageBody,
      "",
      "  return { v449 };",
      "}",
    ]);
    record([YEAR, STAGE], {
      [YEAR]: { runYear: 455 },
      [STAGE]: { vStage },
    });
    commit(
      "refactor: the v stage\n\nMechanical: stage cut\nRatchet-raise: size-baseline.json — src/stage.ts +20; src/stage.ts vStage +10, a stage",
    );
  };

  it("passes a stage cut (owner v0.10.3 Q1): imports, signature, return, brace and call, its entry its moved lines and those", () => {
    git("checkout", "-q", "-B", "stage-base", base);
    write(YEAR, yearFn(vs(0, 900)));
    record([YEAR], { [YEAR]: { runYear: 904 } });
    longYear = commit("chore: a long year");
    staged();
    const report = checkRatchets(longYear, "HEAD", dir);
    expect(report.failures).toEqual([]);
    expect(report.excused).toEqual([
      expect.stringContaining("files src/stage.ts, src/year.ts"),
      expect.stringContaining("src/stage.ts vStage"),
    ]);

    // A blank line inside: the code lines balance, the entry doesn't.
    const inner = vs(0, 450).map((l) => `  ${l}`);
    staged([...inner.slice(0, 5), "", ...inner.slice(5)], 455);
    expect(checkRatchets(longYear, "HEAD", dir).failures).toEqual([
      expect.stringContaining(
        "src/stage.ts vStage(): 455, its 450 moved lines +4 for its signature and return",
      ),
    ]);
    // A statement edited on the way: no stage, so only imports.
    staged(vs(0, 450, (l) => `  ${l.replace("a, 7)", "a, 8)")}`));
    expect(checkRatchets(longYear, "HEAD", dir).failures).toEqual([
      expect.stringMatching(/files .*: 914 .*which adds 2 import lines/),
      expect.stringMatching(/functions .*: 909 .*adds 0 lines of import/),
    ]);
  });

  const ROW = "src/row.tsx";
  const UI_PART = "src/part.tsx";
  const tds = (from: number, to: number, edit = (l: string) => l) =>
    Array.from({ length: to - from }, (_, k) =>
      edit(`<td>{a + ${from + k}}</td>`),
    );
  const rowFn = (inner: string[], extraImports: string[] = []) => [
    ...extraImports,
    ...(extraImports.length > 0 ? [""] : []),
    "export function Row({ a }: { a: number }) {",
    "  return (",
    "    <tr>",
    ...inner.map((l) => `      ${l}`),
    "    </tr>",
    "  );",
    "}",
  ];
  let longRow = "";
  const jsxCut = (run = tds(0, 450).map((l) => `      ${l}`), part = 456) => {
    git("checkout", "-q", "-B", "jsx", longRow);
    write(
      ROW,
      rowFn(
        ["<Part a={a} />", ...tds(450, 900)],
        ['import { Part } from "./part";'],
      ),
    );
    write(UI_PART, [
      "export function Part({ a }: { a: number }) {",
      "  return (",
      "    <>",
      ...run,
      "    </>",
      "  );",
      "}",
    ]);
    record([ROW, UI_PART], { [ROW]: { Row: 457 }, [UI_PART]: { Part: part } });
    commit(
      "refactor: the first cells are a part\n\nMechanical: JSX run cut\nRatchet-raise: size-baseline.json — src/part.tsx +20; src/part.tsx Part +10, a UI cut",
    );
  };

  it("passes a JSX run cut into a component (owner v0.10.4 Q3): imports, its function's lines and the call, its entry its moved lines and those", () => {
    git("checkout", "-q", "-B", "jsx-base", base);
    write(ROW, rowFn(tds(0, 900)));
    record([ROW], { [ROW]: { Row: 906 } });
    longRow = commit("chore: a long row");
    jsxCut();
    const report = checkRatchets(longRow, "HEAD", dir);
    expect(report.failures).toEqual([]);
    expect(report.excused).toEqual([
      expect.stringContaining("files src/part.tsx, src/row.tsx"),
      expect.stringContaining("src/part.tsx Part"),
    ]);

    // A cell edited on the way: no cut, so only imports.
    jsxCut(tds(0, 450, (l) => `      ${l.replace("a + 7}", "a + 8}")}`));
    expect(checkRatchets(longRow, "HEAD", dir).failures).toEqual([
      expect.stringMatching(/files .*: 915 .*which adds 1 import lines/),
      expect.stringMatching(/functions .*adds 0 lines of import/),
    ]);
  });
});

describe("checkRatchets: Known-renamed", () => {
  let dir: string;
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  const LIST = "tests/lint/violations.test.ts";
  const list = (built: string[], known: Record<string, number>) =>
    [
      `const BUILT_AT_LOAD = [${built.map((e) => JSON.stringify(e)).join(", ")}];`,
      `const KNOWN_COUNTS = { ${Object.entries(known)
        .map(([k, n]) => `${JSON.stringify(k)}: { count: ${n} }`)
        .join(", ")} };`,
    ].join("\n");
  const write = (text: string) => fs.writeFileSync(path.join(dir, LIST), text);
  const commit = (message: string) => {
    git("add", "-A");
    git("commit", "-q", "-m", message);
    return git("rev-parse", "HEAD");
  };
  const trailer = (from: string, to: string) =>
    `Known-renamed: ${LIST} — ${from} => ${to}`;
  let base: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-known-renamed-"));
    git("init", "-q", "-b", "main");
    git("config", "user.email", "t@example.invalid");
    git("config", "user.name", "Test");
    fs.mkdirSync(path.join(dir, "tests/lint"), { recursive: true });
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src/r.ts"), "export const r = 1;\n");
    write(list(["src/r.ts rRouter", "src/s.ts sInput"], { "src/r.ts k": 2 }));
    base = commit("chore: base");
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("passes a renamed entry, on its path or its file's rename", () => {
    git("checkout", "-q", "-B", "ok", base);
    write(list(["src/r.ts rInput", "src/s.ts sInput"], { "src/r.ts k": 2 }));
    commit(
      `refactor: name it\n\nBecause.\n\n${trailer("src/r.ts rRouter", "src/r.ts rInput")}`,
    );
    git("mv", "src/r.ts", "src/q.ts");
    write(list(["src/q.ts rInput", "src/s.ts sInput"], { "src/q.ts k": 2 }));
    commit("refactor: r becomes q\n\nMechanical: rename");
    const report = checkRatchets(base, "HEAD", dir);
    expect(report.failures).toEqual([]);
    expect(report.excused).toEqual([
      expect.stringContaining(
        `BUILT_AT_LOAD › src/r.ts rInput: added, by "Known-renamed:`,
      ),
    ]);
  });

  it("fails a rename that also raises the count", () => {
    git("checkout", "-q", "-B", "count", base);
    write(list(["src/r.ts rRouter", "src/s.ts sInput"], { "src/r.ts j": 3 }));
    commit(
      `refactor: name it\n\nBecause.\n\n${trailer("src/r.ts k", "src/r.ts j")}`,
    );
    const { failures, excused } = checkRatchets(base, "HEAD", dir);
    expect(excused).toEqual([]);
    expect(failures).toEqual([
      expect.stringContaining("the count changed (2 → 3)"),
      expect.stringContaining("KNOWN_COUNTS › src/r.ts j: added"),
    ]);
  });

  it("fails a trailer naming a key that did not disappear", () => {
    git("checkout", "-q", "-B", "kept", base);
    write(
      list(["src/r.ts rRouter", "src/r.ts rInput", "src/s.ts sInput"], {
        "src/r.ts k": 2,
      }),
    );
    commit(
      `refactor: name it\n\nBecause.\n\n${trailer("src/r.ts rRouter", "src/r.ts rInput")}`,
    );
    const { failures, excused } = checkRatchets(base, "HEAD", dir);
    expect(excused).toEqual([]);
    expect(failures).toEqual([
      expect.stringContaining("src/r.ts rRouter is still in"),
      expect.stringContaining("BUILT_AT_LOAD › src/r.ts rInput: added"),
    ]);
  });

  it("fails a rename beside another rise in its list", () => {
    git("checkout", "-q", "-B", "other", base);
    write(
      list(["src/r.ts rInput", "src/s.ts sInput", "src/t.ts tInput"], {
        "src/r.ts k": 2,
      }),
    );
    commit(
      `refactor: name it\n\nBecause.\n\n${trailer("src/r.ts rRouter", "src/r.ts rInput")}`,
    );
    const { failures, excused } = checkRatchets(base, "HEAD", dir);
    expect(excused).toEqual([]);
    expect(failures).toContainEqual(
      expect.stringContaining("another entry of BUILT_AT_LOAD rose"),
    );
  });

  it("fails a rename whose trailer is in another commit", () => {
    git("checkout", "-q", "-B", "elsewhere", base);
    write(list(["src/r.ts rInput", "src/s.ts sInput"], { "src/r.ts k": 2 }));
    commit("refactor: name it\n\nBecause.");
    fs.writeFileSync(path.join(dir, "src/r.ts"), "export const r = 2;\n");
    commit(
      `chore: other\n\nBecause.\n\n${trailer("src/r.ts rRouter", "src/r.ts rInput")}`,
    );
    const { failures, excused } = checkRatchets(base, "HEAD", dir);
    expect(excused).toEqual([]);
    expect(failures).toEqual([
      expect.stringContaining("BUILT_AT_LOAD › src/r.ts rInput: added"),
      expect.stringContaining("src/r.ts rRouter is not one entry"),
    ]);
  });
});
