/**
 * The counted ratchet rules of eslint-ratchet.mjs that v0.10.4's UI work
 * lowers (owner Q4): each rule fires on its pattern and stays quiet on the
 * shapes it allows. Plain JSX through ESLint's own parser; nothing reads src/.
 */
import { Linter } from "eslint";
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
