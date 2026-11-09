/**
 * The counted ratchet rules of eslint-ratchet.mjs that v0.10.4's UI work
 * lowers (owner Q4): each rule fires on its pattern and stays quiet on the
 * shapes it allows. Plain JSX through ESLint's own parser; nothing reads src/.
 */
import { ESLint, Linter } from "eslint";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ratchetPlugin } from "../../eslint-ratchet.mjs";
import { sitesIn } from "../../scripts/fallback-inventory";

const linter = new Linter({ configType: "flat" });

/** The lines `rule` reports in `code`. */
function reported(rule: string, code: string): number[] {
  return linter
    .verify(
      code,
      [
        {
          files: ["**/*.jsx"],
          plugins: { ratchet: ratchetPlugin },
          languageOptions: {
            parserOptions: { ecmaFeatures: { jsx: true } },
          },
          rules: { [`ratchet/${rule}`]: "error" },
        },
      ],
      "component.jsx",
    )
    .map((m) => {
      expect(m.ruleId).toBe(`ratchet/${rule}`);
      return m.line;
    });
}

describe("ratchet/no-raw-button", () => {
  it("counts a raw <button>, not the Button primitive", () => {
    expect(
      reported(
        "no-raw-button",
        [
          "const a = <button type='button'>Go</button>;",
          "const b = <Button>Go</Button>;",
        ].join("\n"),
      ),
    ).toEqual([1]);
  });
});

describe("ratchet/no-unlabeled-control", () => {
  it("counts a control with no name: raw or a form primitive", () => {
    expect(
      reported(
        "no-unlabeled-control",
        [
          "const a = <input value={v} />;",
          "const b = <FormSelect value={v} />;",
          "const c = <textarea id='notes' />;",
        ].join("\n"),
      ),
    ).toEqual([1, 2, 3]);
  });

  it("passes aria-label, a label or FormField around it, a matching htmlFor, hidden and spread", () => {
    expect(
      reported(
        "no-unlabeled-control",
        [
          "const a = <input aria-label='Amount' />;",
          "const b = <input aria-labelledby='amount-head' />;",
          "const c = <label>Amount <input /></label>;",
          "const d = <FormField label='Amount'><FormInput /></FormField>;",
          "const e = <><label htmlFor='amt'>Amount</label><input id='amt' /></>;",
          "const f = <><label htmlFor={id}>Amount</label><select id={id} /></>;",
          "const g = <input type='hidden' value={v} />;",
          "const h = <input {...props} />;",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("counts an id no label names", () => {
    expect(
      reported(
        "no-unlabeled-control",
        "const a = <><label htmlFor='other'>X</label><input id='amt' /></>;",
      ),
    ).toEqual([1]);
  });
});

describe("ratchet/no-raw-tablist", () => {
  it("counts role tab, tablist and radiogroup, not other roles", () => {
    expect(
      reported(
        "no-raw-tablist",
        [
          "const a = <div role='tablist' />;",
          "const b = <button role='tab' />;",
          "const c = <div role='radiogroup' />;",
          "const d = <div role='dialog' />;",
        ].join("\n"),
      ),
    ).toEqual([1, 2, 3]);
  });
});

describe("ratchet/no-hand-date-format", () => {
  it("counts toLocaleDateString and toLocaleTimeString, not toLocaleString", () => {
    expect(
      reported(
        "no-hand-date-format",
        [
          "const a = d.toLocaleDateString('en-US');",
          "const b = new Date().toLocaleTimeString();",
          "const c = n.toLocaleString();",
          "const e = formatDate(d, 'short');",
        ].join("\n"),
      ),
    ).toEqual([1, 2]);
  });
});

describe("ratchet/no-raw-chart-container", () => {
  it("counts a ResponsiveContainer, not a chart inside one", () => {
    expect(
      reported(
        "no-raw-chart-container",
        [
          "const a = <ResponsiveContainer width='100%'>",
          "  <LineChart data={rows} />",
          "</ResponsiveContainer>;",
        ].join("\n"),
      ),
    ).toEqual([1]);
  });
});

describe("ratchet/no-abbreviation", () => {
  it("counts a declared name with an abbreviated word, a plural included", () => {
    expect(
      reported(
        "no-abbreviation",
        [
          "const totalAmt = 1;",
          "function f(rowIdx) { return rowIdx; }",
          "const o = { mcRuns: 1 };",
          "const { indAccts } = x;",
          "class Yr {}",
          "import { a as decBal } from 'm';",
          "try {} catch (wdErr) {}",
        ].join("\n"),
      ),
    ).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("counts the second set (owner W8): ind, perf, cat, brok, decum, accum, ret", () => {
    expect(
      reported(
        "no-abbreviation",
        [
          "const indKey = 1;",
          "const perfRows = 1;",
          "const parentCat = 1;",
          "const brokAccounts = 1;",
          "const decumYears = 1;",
          "const accumPhase = 1;",
          "const retAge = 1;",
          "const individualKey = performance + category + brokerage + retirement + returns + catalog + index + decimal;",
        ].join("\n"),
      ),
    ).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("passes full words, words that only contain one, uses, imports and carve-outs", () => {
    expect(
      reported(
        "no-abbreviation",
        [
          "const totalAmount = decimal + estimate + month + balance;",
          "const o = { amount: x.totalAmt, [yrKey]: 1, totalPct };",
          "f(rowIdx);",
          "import { mcResult } from 'm';",
          "const { employerMaxMatchPct } = row;",
          "const pct = 1;",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("counts type names, enum members and property and method signatures", async () => {
    const eslint = new ESLint({ cwd: path.resolve(__dirname, "../..") });
    const [result] = await eslint.lintText(
      [
        "export type AcctRow = { yrEnd: number; calcIt(): void };",
        "export interface Plan { contribs2: number }",
        "export enum Mode { WdFirst }",
        "",
      ].join("\n"),
      { filePath: "src/lib/pure/demo/part.ts" },
    );
    expect(
      result!.messages
        .filter((m) => m.ruleId === "ratchet/no-abbreviation")
        .map((m) => m.message.split("'")[1]),
    ).toEqual(["AcctRow", "yrEnd", "calcIt", "contribs2", "WdFirst"]);
  }, 30_000);
});

describe("ratchet/no-config-reach-through", () => {
  it("counts displayLabel read off the config entry, not through getDisplayConfig (owner Q10b)", () => {
    expect(
      reported(
        "no-config-reach-through",
        [
          "const a = getAccountTypeConfig(t).displayLabel;",
          "const b = ACCOUNT_TYPE_CONFIG[t].displayLabel;",
          "const c = getAccountTypeConfig(t)?.displayLabel;",
          "const d = getDisplayConfig(t, subType).displayLabel;",
          "const e = getAccountTypeConfig(t).supportsRothSplit;",
        ].join("\n"),
      ),
    ).toEqual([1, 2, 3]);
  });
});

describe("ratchet/no-history-comment: plan and owner-question ids", () => {
  it("counts an owner or plan id, bare or named, not a quarter, a tax form or an answer-key case", () => {
    const lines = (comments: string[]) =>
      reported(
        "no-history-comment",
        comments.map((c, i) => `// ${c}\nconst a${i} = ${i};`).join("\n"),
      ).map((line) => (line + 1) / 2);
    expect(
      lines([
        "the boundary names the failed load in words (owner Q18)",
        "falls back to the strategy's key (FQ8)",
        "kept per person: N3",
        "a proven comments-only commit, V6.",
        "the saved changes apply (D6)",
        "owner H6 settled the basis",
        "2026 YTD (Q1)",
        "Q4 2026 estimate",
        "the W2 box 1 wages",
        "the answer key's ret/R12 case",
        "a NAT64 prefix on an IPv6 network",
        "P5 worst case",
      ]),
    ).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("ratchet/no-lint-violation-ok (owner Q10c)", () => {
  it("counts each escape in a line, block or JSX comment, with a reason or without", () => {
    const messages = linter.verify(
      [
        "const a = 1; // lint-violation-ok: fixture",
        "/* lint-violation-ok: one */ /* lint-violation-ok:two */",
        "/**",
        " * lint-violation-ok: first, lint-violation-ok: second",
        " */",
        "const b = <div>{/* lint-violation-ok: JSX */}</div>;",
        "// the reason is missing. lint-violation-ok",
        "const c = 'lint-violation-ok: in a string, not a comment';",
      ].join("\n"),
      [
        {
          files: ["**/*.jsx"],
          plugins: { ratchet: ratchetPlugin },
          languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
          rules: { "ratchet/no-lint-violation-ok": "error" },
        },
      ],
      "component.jsx",
    );
    expect(messages.map((m) => [m.line, m.column])).toEqual([
      [1, 17],
      [2, 4],
      [2, 33],
      [4, 4],
      [4, 30],
      [6, 20],
      [7, 27],
    ]);
    expect(messages.at(-1)!.message).toContain("no reason");
    expect(messages[0]!.message).not.toContain("no reason");
  });

  it("covers src, tests and scripts, not the finders' own file", async () => {
    const eslint = new ESLint({ cwd: path.resolve(__dirname, "../..") });
    const code = "export const a = 1; // lint-violation-ok: fixture\n";
    const counted = async (filePath: string) => {
      const [result] = await eslint.lintText(code, { filePath });
      return result!.messages.some(
        (m) => m.ruleId === "ratchet/no-lint-violation-ok",
      );
    };
    expect(await counted("src/lib/pure/demo/part.ts")).toBe(true);
    expect(await counted("src/components/demo/part.tsx")).toBe(true);
    expect(await counted("tests/demo/part.test.ts")).toBe(true);
    expect(await counted("scripts/demo-part.ts")).toBe(true);
    expect(await counted("tests/lint/violations.test.ts")).toBe(false);
  }, 30_000);
});

describe("ratchet/no-clock-read", () => {
  it("counts new Date() with no argument, also inside a call, and Date.now()", () => {
    expect(
      reported(
        "no-clock-read",
        [
          "const a = new Date();",
          "const b = Date.now();",
          "const c = calendarDateOf(new Date());",
          "const d = new Date(ms);",
          "const e = calendarDateOf(asOf);",
          "const f = Date.UTC(2026, 0, 1);",
        ].join("\n"),
      ),
    ).toEqual([1, 2, 3]);
  });

  it("covers server and lib code, not the scope's clock, the stamp helper, client hooks or the UI", async () => {
    const eslint = new ESLint({ cwd: path.resolve(__dirname, "../..") });
    const code = "export const today = () => new Date();\n";
    const counted = async (filePath: string) => {
      const [result] = await eslint.lintText(code, { filePath });
      return result!.messages.some((m) => m.ruleId === "ratchet/no-clock-read");
    };
    expect(await counted("src/server/services/demo/part.ts")).toBe(true);
    expect(await counted("src/lib/pure/demo/part.ts")).toBe(true);
    expect(await counted("src/server/trpc.ts")).toBe(false);
    expect(await counted("src/lib/utils/clock.ts")).toBe(false);
    expect(await counted("src/lib/hooks/use-demo.ts")).toBe(false);
    expect(await counted("src/components/demo/part.tsx")).toBe(false);
  }, 30_000);
});

describe("ratchet/no-unregistered-fallback (docs/FALLBACKS.md)", () => {
  const code = [
    "const a = row.amount ?? 0;",
    "const b = row.amount || 0;",
    "const c = byId.get(id) ?? 0;",
    "const d = limits[key] ?? 0;",
    "total.sum = (total.sum ?? 0) + v;",
    "out[k] = (out[k] ?? 0) + v;",
    "const e = row.name ?? '';",
    "try { f(); } catch { return null; }",
    "try { f(); } catch (e) { log(e); throw e; }",
    "try { f(); } catch { const g = () => 1; }",
    "p.catch(() => null);",
    "p.catch(() => fallbackRows());",
    "p.catch((e) => void log(e));",
    "p.catch((e) => { log(e); });",
    "const h = readMaybeEncrypted(row.config);",
  ].join("\n");
  const lines = (zeroDefaults: boolean) =>
    linter
      .verify(
        `function wrap() {\n${code}\n}`,
        [
          {
            files: ["**/*.ts"],
            plugins: { ratchet: ratchetPlugin },
            rules: {
              "ratchet/no-unregistered-fallback": ["error", { zeroDefaults }],
            },
          },
        ],
        "part.ts",
      )
      .map((m) => m.line - 1);

  it("counts ?? 0 and || 0 in money code, record reads included, not Map reads or seeds", () => {
    expect(lines(true)).toEqual([1, 2, 4, 8, 11, 12, 15]);
  });

  it("counts value-returning catches (a call's value too) and readMaybe* calls everywhere", () => {
    expect(lines(false)).toEqual([8, 11, 12, 15]);
  });

  it("agrees with scripts/fallback-inventory.ts on what is counted", () => {
    const counted = sitesIn("src/lib/pure/demo/part.ts", code)
      .filter((s) => s.counted)
      .map((s) => s.line);
    expect(counted).toEqual(lines(true));
  });

  it("counts zero defaults in money paths only", async () => {
    const eslint = new ESLint({ cwd: path.resolve(__dirname, "../..") });
    const zero = "export const f = (x?: number) => x ?? 0;\n";
    const counted = async (filePath: string) => {
      const [result] = await eslint.lintText(zero, { filePath });
      return result!.messages.some(
        (m) => m.ruleId === "ratchet/no-unregistered-fallback",
      );
    };
    expect(await counted("src/lib/pure/demo/part.ts")).toBe(true);
    expect(await counted("src/server/services/demo/part.ts")).toBe(true);
    expect(await counted("src/server/routers/demo/part.ts")).toBe(true);
    expect(await counted("src/server/data/demo/part.ts")).toBe(true);
    expect(await counted("src/components/demo/part.tsx")).toBe(false);
    expect(await counted("src/lib/db/demo.ts")).toBe(false);
  }, 30_000);
});

describe("ratchet/no-identity-predicate-import", () => {
  it("counts each predicate imported, not the behavior helpers", () => {
    expect(
      reported(
        "no-identity-predicate-import",
        [
          "import { isHsaCategory, isIraCategory } from '@/lib/config/account-types';",
          "import { isTaxableCategory, getLimitGroup } from '@/lib/config/account-types';",
        ].join("\n"),
      ),
    ).toEqual([1, 1]);
  });

  it("leaves Tax Buckets' four files to them until v0.11", async () => {
    const eslint = new ESLint({ cwd: path.resolve(__dirname, "../..") });
    const code =
      "import { isHsaCategory } from '@/lib/config/account-types';\nexport const f = isHsaCategory;\n";
    const counted = async (filePath: string) => {
      const [result] = await eslint.lintText(code, { filePath });
      return result!.messages.some(
        (m) => m.ruleId === "ratchet/no-identity-predicate-import",
      );
    };
    expect(await counted("src/lib/pure/demo/part.ts")).toBe(true);
    expect(await counted("src/components/demo/part.tsx")).toBe(true);
    expect(
      await counted("src/app/(dashboard)/tax-buckets/tax-buckets-grouping.ts"),
    ).toBe(false);
    expect(await counted("src/lib/pure/accounts/tax-bucket-analysis.ts")).toBe(
      false,
    );
  }, 30_000);
});

describe("ratchet/no-retired-ui-word", () => {
  it("counts MC, pin, override and customize in JSX text and shown string props", () => {
    expect(
      reported(
        "no-retired-ui-word",
        [
          "const a = <p>Each MC trial draws</p>;",
          "const b = <p>Pinned profile</p>;",
          "const c = <HelpTip text='You can override it' />;",
          "const d = <HelpTip text={`Customize ${x} here`} />;",
          "const e = <p>{'Overrides apply'}</p>;",
          "const f = <Tab label='Customization' />;",
        ].join("\n"),
      ),
    ).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("passes other words, lowercase mc, hidden props and code", () => {
    expect(
      reported(
        "no-retired-ui-word",
        [
          "const a = <p>Simulation trials, active profile, spinning, mcdonald</p>;",
          "const b = <div className='pin-1' data-testid='override-row' id='mc' />;",
          "const c = <button onClick={() => setOverride(null)}>Reset</button>;",
          "const d = overrides.map((o) => <Row key={o.id} />);",
          "const e = <p>{mcResult.median}</p>;",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("covers components and app, not lib", async () => {
    const eslint = new ESLint({ cwd: path.resolve(__dirname, "../..") });
    const code = "export const P = () => <p>MC results</p>;\n";
    const counted = async (filePath: string) => {
      const [result] = await eslint.lintText(code, { filePath });
      return result!.messages.some(
        (m) => m.ruleId === "ratchet/no-retired-ui-word",
      );
    };
    expect(await counted("src/components/demo/part.tsx")).toBe(true);
    expect(await counted("src/app/demo/part.tsx")).toBe(true);
    expect(await counted("src/lib/demo/part.tsx")).toBe(false);
  }, 30_000);
});

describe("the repo config's scopes (owner Q4, v0.10.4)", () => {
  const eslint = new ESLint({ cwd: path.resolve(__dirname, "../..") });
  /** The rules the repo config reports for `code` written at `file`. */
  const rulesAt = async (file: string, code: string) => {
    const [result] = await eslint.lintText(code, { filePath: file });
    return [...new Set(result!.messages.map((m) => m.ruleId))].sort();
  };
  const NEW_RULES = [
    "jsx-a11y/click-events-have-key-events",
    "jsx-a11y/no-static-element-interactions",
    "ratchet/no-hand-date-format",
    "ratchet/no-raw-button",
    "ratchet/no-raw-chart-container",
    "ratchet/no-raw-tablist",
    "ratchet/no-unlabeled-control",
  ];
  const code = [
    "export function Part({ go, d }: { go: () => void; d: Date }) {",
    "  return (",
    "    <div role='tablist'>",
    "      <button type='button'>{d.toLocaleDateString()}</button>",
    "      <div onClick={go}>x</div>",
    "      <input />",
    "      <ResponsiveContainer />",
    "    </div>",
    "  );",
    "}",
    "",
  ].join("\n");
  const only = (rules: (string | null)[]) =>
    rules.filter((r) => r !== null && NEW_RULES.includes(r));

  it("counts every new rule in a feature component", async () => {
    expect(only(await rulesAt("src/components/demo/part.tsx", code))).toEqual(
      NEW_RULES,
    );
  }, 30_000);

  it("leaves each primitive's own folder to it", async () => {
    expect(only(await rulesAt("src/components/ui/part.tsx", code))).toEqual(
      NEW_RULES.filter(
        (r) => r !== "ratchet/no-raw-button" && r !== "ratchet/no-raw-tablist",
      ),
    );
    expect(
      only(await rulesAt("src/components/charts/part.tsx", code)),
    ).not.toContain("ratchet/no-raw-chart-container");
    expect(
      only(
        await rulesAt(
          "src/lib/utils/format.ts",
          "export const f = (d: Date) => d.toLocaleDateString();\n",
        ),
      ),
    ).toEqual([]);
  }, 30_000);
});
