/**
 * Smoke test before the split of savings/extra-paycheck-rules-editor.tsx
 * (RULES § Refactoring: smoke tests before any split; target-architecture
 * § 8.7: smoke + one save). A dated temporary net: the split that replaces
 * the file replaces this test.
 *
 * Invented household: Priya is paid biweekly and routes her extra
 * paychecks 60/40 to two savings goals; Tomas is paid monthly, so he has no
 * extra paychecks to route.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { formatCurrency } from "@/lib/utils/format";
import type { ExtraPaycheckRoutingData } from "@/lib/db/schema-pg";
import { mutationCalls, resetTrpcMock, setQuery } from "./trpc-mock";

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./trpc-mock")).trpc,
}));

import { ExtraPaycheckRulesEditor } from "@/components/savings/extra-paycheck-rules-editor";

const goals = [
  { id: 31, name: "Emergency Fund" },
  { id: 32, name: "Japan Trip" },
];

const priyaRouting: ExtraPaycheckRoutingData = {
  rules: [
    {
      from: "2026-01",
      to: null,
      splits: [
        { goalId: 31, pct: 60 },
        { goalId: 32, pct: 40 },
      ],
    },
  ],
  baseNetPayPerCheck: 3100,
  baseYear: 2026,
};

const jobs = [
  {
    id: 10,
    personId: 1,
    personName: "Priya",
    employerName: "Northwind Clinic",
    payPeriod: "biweekly" as const,
    anchorPayDate: "2026-01-09",
    extraPaycheckRouting: priyaRouting,
  },
  {
    id: 20,
    personId: 2,
    personName: "Tomas",
    employerName: "Harbor Schools",
    payPeriod: "monthly" as const,
    anchorPayDate: null,
    extraPaycheckRouting: null,
  },
];

// The two years the savings projection shows.
const monthDates = Array.from({ length: 24 }, (_, i) => new Date(2026, i, 1));

// The growth editor's rows count years after today's: the tests read as of
// 7 Nov 2026.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 7));
  resetTrpcMock();
  setQuery("savings.extraPaycheckRouting.list", jobs);
});

afterEach(() => {
  vi.useRealTimers();
});

const renderEditor = () =>
  render(
    <ExtraPaycheckRulesEditor
      goals={goals}
      netPayByPersonId={
        new Map([
          [1, 3100],
          [2, 4200],
        ])
      }
      monthDates={monthDates}
    />,
  );

/** Priya's rule row: the one naming her first goal. */
const ruleRow = () => screen.getAllByText("Emergency Fund")[0]!.closest("tr")!;

describe("ExtraPaycheckRulesEditor smoke", () => {
  it("one block per person: Priya's rule and its split, Tomas not biweekly", () => {
    renderEditor();
    expect(screen.getByRole("heading", { name: "Priya" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Tomas" })).toBeInTheDocument();
    const row = ruleRow();
    expect(row).toHaveTextContent("Jan 2026");
    expect(row).toHaveTextContent("60%");
    expect(row).toHaveTextContent("Japan Trip");
    expect(row).toHaveTextContent("40%");
    expect(row).toHaveTextContent(formatCurrency(3100));
    expect(document.body).toHaveTextContent(/biweekly/i);
    // Nothing is written on mount (the base net pay is already stored).
    expect(mutationCalls("savings.extraPaycheckRouting.saveGrowth")).toEqual(
      [],
    );
  });

  it("editing the rule's split and saving sends the job's whole rule list", () => {
    renderEditor();
    fireEvent.click(within(ruleRow()).getByRole("button", { name: "Edit" }));
    const form = screen.getByText(/edit rule/i).parentElement!;
    const [first, second] = within(form).getAllByRole("spinbutton");
    fireEvent.change(first!, { target: { value: "75" } });
    fireEvent.change(second!, { target: { value: "25" } });
    fireEvent.click(within(form).getByRole("button", { name: /save rule/i }));
    expect(mutationCalls("savings.extraPaycheckRouting.save")).toEqual([
      {
        jobId: 10,
        rules: [
          {
            from: "2026-01",
            to: null,
            splits: [
              { goalId: 31, pct: 75 },
              { goalId: 32, pct: 25 },
            ],
          },
        ],
        yearlyGrowth: {},
      },
    ]);
  });

  /** Priya's block, from her heading down. */
  const priya = () =>
    screen.getByRole("heading", { name: "Priya" }).parentElement!;
  const text = (el: Element) =>
    (el.textContent ?? "").replace(/\s+/g, " ").trim();

  it("Priya's panel: destination, growth, rule, months and add, with today's formatters", () => {
    renderEditor();
    const m = formatCurrency;
    expect(text(priya())).toBe(
      [
        "Priya",
        "Extra paycheck goes to:SavingsBudget",
        `Annual raise% / yrset by yearBase ${m(3100)}/check · saved 2026`,
        "Apply growth ratesRe-apply after salary changes",
        `FromToRoutingNet / checkJan 2026∞Emergency Fund 60%Japan Trip 40%${m(3100)}Edit×`,
        "Specific months+ Add a monthNone set.",
        "+ Add rule",
      ].join(""),
    );
  });

  it("the destination toggle, Apply growth rates and a rule's delete each send their write", () => {
    renderEditor();
    fireEvent.click(within(priya()).getByRole("button", { name: "Budget" }));
    fireEvent.click(within(priya()).getByRole("button", { name: "Savings" }));
    fireEvent.click(
      within(priya()).getByRole("button", { name: "Apply growth rates" }),
    );
    fireEvent.click(within(ruleRow()).getByRole("button", { name: "×" }));
    expect(mutationCalls("savings.extraPaycheckRouting.setEnabled")).toEqual([
      { jobId: 10, enabled: false },
      { jobId: 10, enabled: true },
    ]);
    expect(mutationCalls("savings.extraPaycheckRouting.saveGrowth")).toEqual([
      { jobId: 10, yearlyGrowth: {} },
    ]);
    expect(mutationCalls("savings.extraPaycheckRouting.save")).toEqual([
      { jobId: 10, rules: [] },
    ]);
  });

  it("a month override is listed, edited, deleted and added", () => {
    setQuery("savings.extraPaycheckRouting.list", [
      {
        ...jobs[0]!,
        extraPaycheckRouting: {
          ...priyaRouting,
          overrides: [{ month: "2026-05", splits: [{ goalId: 32, pct: 100 }] }],
        },
      },
    ]);
    renderEditor();
    const months =
      screen.getByText("Specific months").parentElement!.parentElement!;
    expect(text(months)).toBe(
      "Specific months+ Add a monthMay 2026Japan Trip 100%Edit×",
    );
    fireEvent.click(within(months).getByRole("button", { name: "×" }));
    fireEvent.click(within(months).getByRole("button", { name: "Edit" }));
    expect(text(months)).toMatch(
      /^Specific monthsOverride — May 2026Fund splits/,
    );
    const [goal] = within(months).getAllByRole("combobox");
    fireEvent.change(goal!, { target: { value: "31" } });
    fireEvent.click(within(months).getByRole("button", { name: "Save month" }));
    // A saved month closes its form.

    fireEvent.click(
      within(months).getByRole("button", { name: "+ Add a month" }),
    );
    const [month, fund] = within(months).getAllByRole("combobox");
    expect(
      within(month!)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual([
      "— pick a month —",
      "May 2026 ↺",
      "Oct 2026",
      "Apr 2027",
      "Oct 2027",
    ]);
    fireEvent.change(month!, { target: { value: "2026-10" } });
    fireEvent.change(fund!, { target: { value: "32" } });
    fireEvent.click(within(months).getByRole("button", { name: "+ add fund" }));
    const [, , second] = within(months).getAllByRole("combobox");
    fireEvent.change(second!, { target: { value: "31" } });
    const [, pct2] = within(months).getAllByRole("spinbutton");
    fireEvent.change(pct2!, { target: { value: "0" } });
    expect(text(months)).toContain("Total: 100%");
    fireEvent.click(within(months).getByRole("button", { name: "Save month" }));

    expect(mutationCalls("savings.extraPaycheckRouting.saveOverride")).toEqual([
      { jobId: 10, month: "2026-05", splits: null },
      { jobId: 10, month: "2026-05", splits: [{ goalId: 31, pct: 100 }] },
      { jobId: 10, month: "2026-10", splits: [{ goalId: 32, pct: 100 }] },
    ]);
  });

  it("in budget mode the rules are kept and routing reads as paused", () => {
    setQuery("savings.extraPaycheckRouting.list", [
      {
        ...jobs[0]!,
        extraPaycheckRouting: { ...priyaRouting, enabled: false },
      },
    ]);
    renderEditor();
    expect(text(priya())).toBe(
      "PriyaExtra paycheck goes to:SavingsBudgetRouting is paused — the extra paycheck stays as regular income instead of going to a savings goal. Your configured rules are kept; switch back to Savings to resume them. See the Budget page for which months to expect it.",
    );
  });

  it("adding a rule sends it sorted into the job's rules with the growth", () => {
    renderEditor();
    fireEvent.click(
      within(priya()).getByRole("button", { name: "+ Add rule" }),
    );
    const form = screen.getByText(/new rule/i).parentElement!;
    const [from, to] = Array.from(
      form.querySelectorAll('input[type="month"]'),
    ) as HTMLInputElement[];
    fireEvent.change(from!, { target: { value: "2025-07" } });
    fireEvent.change(to!, { target: { value: "2025-12" } });
    const [goal] = within(form).getAllByRole("combobox");
    fireEvent.change(goal!, { target: { value: "32" } });
    fireEvent.click(within(form).getByRole("button", { name: /save rule/i }));
    expect(mutationCalls("savings.extraPaycheckRouting.save")).toEqual([
      {
        jobId: 10,
        rules: [
          {
            from: "2025-07",
            to: "2025-12",
            splits: [{ goalId: 32, pct: 100 }],
          },
          priyaRouting.rules[0],
        ],
        yearlyGrowth: {},
      },
    ]);
  });
});
