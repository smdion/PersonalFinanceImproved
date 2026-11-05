/**
 * Smoke test before the split of tax-buckets/tax-buckets-content.tsx (RULES
 * § Refactoring: smoke tests before any split; target-architecture § 8.7).
 * A dated temporary net: the split that replaces the file replaces this
 * test.
 *
 * `taxBuckets.computeBreakdown`'s answer is built the way the router builds
 * it, from the same pure functions (computeTaxBucketBreakdown,
 * computeTaxBucketAnalysis) over an invented snapshot: Ann (50) holds a
 * Traditional 401k and a Roth IRA, Bo a brokerage account. "At Retirement"
 * reads a real engine run of the same household (projection-household.ts)
 * and the page's own projection over it (computeTaxBucketProjection).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UserProvider } from "@/lib/context/user-context";
import { calculateProjection } from "@/lib/pure/engine";
import { computeTaxBucketBreakdown } from "@/lib/pure/tax-buckets";
import { computeTaxBucketAnalysis } from "@/lib/pure/tax-bucket-analysis";
import { computeTaxBucketProjection } from "@/lib/pure/tax-bucket-projection";
import { formatCurrency } from "@/lib/utils/format";
import { sumBy } from "@/lib/utils/math";
import { annAndBo, engineDataFor } from "./projection-household";
import { resetTrpcMock, setQuery, type MockOutput } from "./trpc-mock";

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./trpc-mock")).trpc,
}));

import { TaxBucketsContent } from "@/app/(dashboard)/tax-buckets/tax-buckets-content";

const people = [
  { id: 1, name: "Ann", birthYear: 1976 },
  { id: 2, name: "Bo", birthYear: 1976 },
];
const perfAccounts = [
  { id: 71, accountType: "401k" as const, ownerPersonId: 1, label: "Ann 401k" },
  {
    id: 72,
    accountType: "ira" as const,
    ownerPersonId: 1,
    label: "Ann Roth IRA",
  },
  {
    id: 73,
    accountType: "brokerage" as const,
    ownerPersonId: 2,
    label: "Bo Brokerage",
  },
];
const snapshotRow = (
  perfId: number,
  taxType: string,
  amount: number,
  parentCategory: string,
) => {
  const p = perfAccounts.find((a) => a.id === perfId)!;
  return {
    institution: "Fidelity",
    taxType,
    accountType: p.accountType,
    subType: null,
    label: null,
    parentCategory,
    amount,
    ownerPersonId: p.ownerPersonId,
    performanceAccountId: perfId,
    displayName: p.label,
    accountLabel: p.label,
  };
};

function breakdownAnswer() {
  const breakdown = computeTaxBucketBreakdown(
    {
      accounts: [
        snapshotRow(71, "preTax", 300000, "Retirement"),
        snapshotRow(72, "taxFree", 150000, "Retirement"),
        snapshotRow(73, "afterTax", 250000, "Retirement"),
      ],
    },
    people,
    perfAccounts.map((p) => ({
      id: p.id,
      isActive: true,
      accountType: p.accountType,
      costBasis: p.id === 73 ? "200000" : null,
    })),
  );
  const accounts = computeTaxBucketAnalysis({
    breakdown,
    performanceAccounts: perfAccounts.map((p) => ({
      id: p.id,
      accountType: p.accountType,
      ownerPersonId: p.ownerPersonId,
      isActive: true,
      separationDate: null,
      costBasis: p.id === 73 ? 200000 : 0,
      accountLabel: p.label,
      displayName: p.label,
      institution: "Fidelity",
    })),
    jobLinks: [],
    rothBasisRows: [],
    people,
    currentDate: new Date("2026-06-15"),
  });
  return {
    portfolioByTaxType: breakdown.portfolioByTaxType,
    accounts,
    people,
  };
}

const engineData = engineDataFor(calculateProjection(annAndBo()));

beforeEach(() => {
  resetTrpcMock();
  localStorage.clear();
  // The pure functions' types are wider than the procedure's output
  // (rothBasisMeta.updatedAt may be a Date before serialization).
  setQuery(
    "taxBuckets.computeBreakdown",
    breakdownAnswer() as MockOutput<"taxBuckets.computeBreakdown">,
  );
  setQuery("projection.computeProjection", engineData);
});

const renderPage = () =>
  render(
    <UserProvider user={{ name: "Ann", role: "admin", permissions: [] }}>
      <TooltipProvider>
        <TaxBucketsContent />
      </TooltipProvider>
    </UserProvider>,
  );

describe("TaxBucketsContent smoke", () => {
  it("Now: the household total and one card per bucket held", () => {
    renderPage();
    expect(document.body).toHaveTextContent(formatCurrency(700000));
    for (const [label, amount] of [
      ["Traditional", 300000],
      ["Roth IRA", 150000],
      ["Brokerage", 250000],
    ] as const) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
      expect(document.body).toHaveTextContent(formatCurrency(amount));
    }
    expect(screen.getByText("Ann 401k")).toBeInTheDocument();
    expect(screen.getByText("Bo Brokerage")).toBeInTheDocument();
  });

  it("At Retirement switches to the projected figures and back", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "At Retirement" }));
    // The projected figures at the household's transition year, never
    // today's.
    const projected = computeTaxBucketProjection({
      nowEntries: breakdownAnswer().accounts,
      projectionByYear: engineData.result.projectionByYear,
      people,
    });
    expect(projected.transitionYear).not.toBeNull();
    expect(document.body).toHaveTextContent(String(projected.transitionYear));
    expect(document.body).toHaveTextContent(
      formatCurrency(sumBy(projected.entries, (e) => e.balance)),
    );
    expect(document.body).not.toHaveTextContent(formatCurrency(700000));
    fireEvent.click(screen.getByRole("button", { name: "Now" }));
    expect(document.body).toHaveTextContent(formatCurrency(700000));
  });
});
