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
import { describe, it, expect, vi, beforeEach } from "vitest";
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

beforeEach(() => {
  resetTrpcMock();
  setQuery("savings.extraPaycheckRouting.list", jobs);
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
});
