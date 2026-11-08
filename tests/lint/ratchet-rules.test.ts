/**
 * The counted ratchet rules of eslint-ratchet.mjs that v0.10.4's UI work
 * lowers (owner Q4): each rule fires on its pattern and stays quiet on the
 * shapes it allows. Plain JSX through ESLint's own parser; nothing reads src/.
 */
import { ESLint, Linter } from "eslint";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ratchetPlugin } from "../../eslint-ratchet.mjs";

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

describe("ratchet/no-clock-read", () => {
  it("counts new Date() and localDateStr() with no argument, and Date.now()", () => {
    expect(
      reported(
        "no-clock-read",
        [
          "const a = new Date();",
          "const b = Date.now();",
          "const c = localDateStr();",
          "const d = new Date(ms);",
          "const e = localDateStr(asOf);",
          "const f = Date.UTC(2026, 0, 1);",
        ].join("\n"),
      ),
    ).toEqual([1, 2, 3]);
  });

  it("covers server and lib code, not the scope's clock, client hooks or the UI", async () => {
    const eslint = new ESLint({ cwd: path.resolve(__dirname, "../..") });
    const code = "export const today = () => new Date();\n";
    const counted = async (filePath: string) => {
      const [result] = await eslint.lintText(code, { filePath });
      return result!.messages.some((m) => m.ruleId === "ratchet/no-clock-read");
    };
    expect(await counted("src/server/services/demo/part.ts")).toBe(true);
    expect(await counted("src/lib/pure/demo/part.ts")).toBe(true);
    expect(await counted("src/server/trpc.ts")).toBe(false);
    expect(await counted("src/lib/hooks/use-demo.ts")).toBe(false);
    expect(await counted("src/components/demo/part.tsx")).toBe(false);
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
