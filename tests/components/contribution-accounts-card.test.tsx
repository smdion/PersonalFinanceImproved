import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AccountCard } from "@/components/portfolio/contribution-accounts-card";

vi.mock("@/components/ui/help-tip", () => ({
  HelpTip: () => null,
}));

vi.mock("@/lib/utils/format", () => ({
  formatCurrency: (n: number) => `$${Math.round(n).toLocaleString()}`,
  accountDisplayName: (acct: { institution: string; accountLabel: string }) =>
    `${acct.institution} ${acct.accountLabel}`,
}));

vi.mock("@/lib/utils/colors", () => ({
  taxTypeLabel: (t: string) => t,
}));

vi.mock("@/lib/config/account-types", () => {
  const mk = (label: string, roth = true) => ({
    displayLabel: label,
    supportsRothSplit: roth,
    colors: {
      border: "border-blue-300",
      bgLight: "bg-blue-50",
      text: "text-blue-600",
    },
  });
  return {
    ACCOUNT_TYPE_CONFIG: {
      "401k": mk("401(k)"),
      ira: mk("IRA"),
      brokerage: mk("Brokerage", false),
      hsa: mk("HSA", false),
    },
    getAllCategories: () => ["401k", "ira", "brokerage", "hsa"],
  };
});

vi.mock("@/components/portfolio/contribution-accounts-inline", () => ({
  InlineText: ({ value }: { value: string }) => <span>{value}</span>,
  InlineSelect: ({ value }: { value: string }) => <span>{value}</span>,
}));

vi.mock("@/components/portfolio/contribution-accounts-sub-account", () => ({
  SubAccountRow: () => (
    <tr data-testid="sub-account-row">
      <td>SubAccount</td>
    </tr>
  ),
  SubAccountInactiveSection: () => (
    <div data-testid="inactive-section">Inactive</div>
  ),
  AddSubAccountForm: () => <div data-testid="add-sub-form">Add Sub</div>,
}));

vi.mock("@/components/portfolio/contribution-accounts-contrib-row", () => ({
  ContributionRow: () => (
    <tr data-testid="contrib-row">
      <td>Contribution</td>
    </tr>
  ),
  AddContribForm: () => <div data-testid="add-contrib-form">Add Contrib</div>,
}));

const baseAccount = {
  id: 1,
  institution: "Fidelity",
  accountType: "401k",
  subType: null,
  label: null,
  accountLabel: "401(k)",
  displayName: null,
  ownerPersonId: 1,
  ownershipType: "individual",
  parentCategory: "401k",
  isActive: true,
  displayOrder: 0,
};

const defaultProps = {
  account: baseAccount,
  contributions: [],
  balance: 150000,
  portfolioSubs: [],
  people: [{ id: 1, name: "Sean" }],
  jobs: [{ id: 1, employerName: "Acme Corp" }],
  personOptions: [{ value: "1", label: "Sean" }],
  categoryOptions: [{ value: "401k", label: "401(k)" }],
  accountTypeOptions: [{ value: "401k", label: "401(k)" }],
  isExpanded: false,
  onToggleExpand: vi.fn(),
  activeAccounts: [],
};

describe("AccountCard", () => {
  it("renders account institution and label", () => {
    render(<AccountCard {...defaultProps} />);
    expect(screen.getByText("Fidelity 401(k)")).toBeInTheDocument();
  });

  it("renders balance", () => {
    render(<AccountCard {...defaultProps} />);
    expect(screen.getByText("$150,000")).toBeInTheDocument();
  });

  it("calls onToggleExpand when header is clicked", () => {
    const onToggleExpand = vi.fn();
    render(<AccountCard {...defaultProps} onToggleExpand={onToggleExpand} />);
    // The header row has cursor-pointer and onClick={onToggleExpand}
    const nameEl = screen.getByText("Fidelity 401(k)");
    const headerRow = nameEl.closest("div[class*='cursor-pointer']")!;
    fireEvent.click(headerRow);
    expect(onToggleExpand).toHaveBeenCalled();
  });

  it("does not show expanded content when collapsed", () => {
    render(<AccountCard {...defaultProps} isExpanded={false} />);
    expect(screen.queryByTestId("sub-account-row")).toBeNull();
    expect(screen.queryByTestId("contrib-row")).toBeNull();
  });

  it("shows expanded content when isExpanded is true", () => {
    render(
      <AccountCard
        {...defaultProps}
        isExpanded={true}
        onPerfUpdate={vi.fn()}
        portfolioSubs={[
          {
            id: 1,
            institution: "Fidelity",
            taxType: "traditional",
            amount: "100000",
            accountType: "401k",
            subType: null,
            label: null,
            ownerPersonId: 1,
            isActive: true,
          },
        ]}
      />,
    );
    // Settings section is auto-expanded
    expect(screen.getByText("Account Settings")).toBeInTheDocument();
    // Sub-Accounts section header should appear
    expect(screen.getByText(/Sub-Accounts/)).toBeInTheDocument();
  });

  it("shows dash for null balance", () => {
    render(<AccountCard {...defaultProps} balance={null} />);
    // null balance renders as "—" (em dash)
    const balanceCells = screen.getAllByText("—");
    expect(balanceCells.length).toBeGreaterThan(0);
  });
});
