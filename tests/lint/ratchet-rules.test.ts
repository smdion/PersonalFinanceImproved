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
