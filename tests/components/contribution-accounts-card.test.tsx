import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AccountCard } from "@/components/contributions/contribution-accounts-card";
import { pressKey } from "./keyboard";

vi.mock("@/components/ui/help-tip", () => ({
  HelpTip: () => null,
}));

vi.mock("@/components/contributions/contribution-accounts-inline", () => ({
  InlineText: ({ value }: { value: string }) => <span>{value}</span>,
  InlineSelect: ({ value }: { value: string }) => <span>{value}</span>,
}));

vi.mock("@/components/contributions/contribution-accounts-sub-account", () => ({
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

vi.mock("@/components/contributions/contribution-accounts-contrib-row", () => ({
  ContributionRow: () => (
    <tr data-testid="contrib-row">
      <td>Contribution</td>
    </tr>
  ),
  AddContributionForm: () => (
    <div data-testid="add-contrib-form">Add Contrib</div>
  ),
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
  parentCategory: "Retirement",
  isActive: true,
  displayOrder: 0,
};

const defaultProps = {
  account: baseAccount,
  contributions: [],
  balance: 150000,
  portfolioSubs: [],
  people: [{ id: 1, name: "Alice" }],
  jobs: [{ id: 1, employerName: "Acme Corp" }],
  personOptions: [{ value: "1", label: "Alice" }],
  categoryOptions: [{ value: "401k", label: "401(k)" }],
  accountTypeOptions: [{ value: "401k", label: "401(k)" }],
  isExpanded: false,
  onToggleExpand: vi.fn(),
  activeAccounts: [],
  activeProfileName: null,
  activeProfileFields: {},
};

describe("AccountCard", () => {
  it("renders the account name, institution and category", () => {
    render(<AccountCard {...defaultProps} />);
    expect(screen.getByText("401(k)")).toBeInTheDocument();
    expect(screen.getByText("Fidelity")).toBeInTheDocument();
    expect(screen.getByText("Retirement")).toBeInTheDocument();
  });

  it("renders balance", () => {
    render(<AccountCard {...defaultProps} />);
    expect(screen.getByText("$150,000.00")).toBeInTheDocument();
  });

  it("calls onToggleExpand when header is clicked", () => {
    const onToggleExpand = vi.fn();
    render(<AccountCard {...defaultProps} onToggleExpand={onToggleExpand} />);
    // The header row has cursor-pointer and onClick={onToggleExpand}
    const nameEl = screen.getByText("Fidelity");
    const headerRow = nameEl.closest("div[class*='cursor-pointer']")!;
    fireEvent.click(headerRow);
    expect(onToggleExpand).toHaveBeenCalled();
  });

  it.each([["Enter" as const], [" " as const]])(
    "%j on the header toggles it, as a click does",
    (key) => {
      const onToggleExpand = vi.fn();
      render(<AccountCard {...defaultProps} onToggleExpand={onToggleExpand} />);
      const header = screen.getByText("Fidelity").closest("[role='button']")!;
      expect(header).toHaveAttribute("tabindex", "0");
      expect(header).toHaveAttribute("aria-expanded", "false");
      pressKey(header as HTMLElement, key);
      expect(onToggleExpand).toHaveBeenCalledTimes(1);
    },
  );

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
