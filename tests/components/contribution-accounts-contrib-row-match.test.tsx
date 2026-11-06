/**
 * The contribution row's employer match: the inline figure and the text
 * read one match. A profile entry that sets only the percent type over a
 * dollar account holds the rate it read then; after the account's dollars
 * change, the figure and the text both show that rate, as the engine reads.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ContributionRow } from "@/components/portfolio/contribution-accounts-contrib-row";
import type { ContribRow } from "@/components/portfolio/contribution-accounts-types";
import {
  entryWithMergedRate,
  storedMatchRate,
} from "@/lib/pure/contributions/employer-match";
import { parseEmployerMatch } from "@/lib/pure/contributions/contribution-amount";

vi.mock("@/components/ui/help-tip", () => ({ HelpTip: () => null }));
vi.mock("@/components/paycheck/roth-route-select", () => ({
  RothRouteSelect: () => null,
}));
vi.mock("@/components/portfolio/contribution-accounts-inline", () => ({
  InlineText: ({ label, value }: { label: string; value: string }) => (
    <span data-testid={`inline-${label}`}>{value}</span>
  ),
  InlineSelect: () => null,
}));

/** A dollar-matched account whose dollars were raised to $60 after the
 *  profile entry below read it as 40%. */
const account: ContribRow = {
  id: 7,
  jobId: 1,
  personId: 1,
  accountType: "401k",
  subType: null,
  label: null,
  parentCategory: "Retirement",
  taxTreatment: "pre_tax",
  employerMatchType: "dollar_match",
  employerMatchValue: "60",
  employerMatchRate: null,
  employerMaxMatchPct: "0.06",
  employerMatchTaxTreatment: "pre_tax",
  hsaCoverageType: null,
  autoMaximize: false,
  isActive: true,
  ownership: "individual",
  performanceAccountId: null,
  targetAnnual: null,
  allocationPriority: 0,
  notes: null,
  isPayrollDeducted: null,
  priorYearContribAmount: "0",
  priorYearContribYear: null,
};

const entry = {
  contributionValue: "6",
  employerMatchType: "percent_of_contribution",
  employerMatchRate: "0.4",
};

describe("the contribution row's match", () => {
  it("shows the same match in its figure and its text, the one the engine reads", () => {
    render(
      <ContributionRow
        contrib={account}
        people={[{ id: 1, name: "Invented Saver" }]}
        jobs={[{ id: 1, employerName: "TestCo" }]}
        accountTypeOptions={[]}
        activeProfileName="Plan A"
        activeProfileFields={entry}
        onUpdate={vi.fn()}
      />,
    );
    expect(screen.getByText(/40% of 6\.00% match/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Edit"));
    expect(screen.getByTestId("inline-Match %").textContent).toBe("40");

    const merged = { ...account, ...entryWithMergedRate(account, entry) };
    expect(
      parseEmployerMatch(
        merged.employerMatchType,
        Number(merged.employerMatchValue),
        Number(merged.employerMaxMatchPct),
        storedMatchRate(merged.employerMatchRate),
      ),
    ).toMatchObject({ kind: "percent_of_contribution", rate: 0.4 });
  });
});
