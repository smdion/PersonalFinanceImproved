import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Smoke tests for src/components/mortgage/mortgage-settings.tsx — loan
// CRUD + extra-payment CRUD settings tab. src/components/mortgage/ had no
// tests at all prior to this. confirm() is mocked to auto-resolve true (the
// pattern used in tests/components/portfolio-content-smoke.test.tsx),
// Button is used unmocked (thin styled <button>).

let currentRole: "admin" | "viewer" = "admin";

vi.mock("@/lib/context/user-context", () => ({
  useUser: () => ({ role: currentRole, name: "Test", permissions: [] }),
  isAdmin: (u: { role: string }) => u.role === "admin",
}));

vi.mock("@/components/ui/confirm-dialog", () => ({
  confirm: vi.fn(async () => true),
}));

const createLoanMutate = vi.fn();
const updateLoanMutate = vi.fn();
const deleteLoanMutate = vi.fn();
const createExtraMutate = vi.fn();
const deleteExtraMutate = vi.fn();
const invalidateLoans = vi.fn();
const invalidateExtras = vi.fn();

const mockLoans = [
  {
    id: 1,
    name: "Original 30yr",
    isActive: false,
    refinancedFromId: null,
    principalAndInterest: "1770.09",
    pmi: "0",
    insuranceAndTaxes: "400",
    totalEscrow: "400",
    interestRate: "0.065",
    termYears: 30,
    originalLoanAmount: "280000",
    firstPaymentDate: "2020-01-01",
    propertyValuePurchase: "350000",
    propertyValueEstimated: null,
    usePurchaseOrEstimated: "purchase",
  },
  {
    id: 2,
    name: "Refi 20yr",
    isActive: true,
    refinancedFromId: 1,
    principalAndInterest: "1600.00",
    pmi: "0",
    insuranceAndTaxes: "400",
    totalEscrow: "400",
    interestRate: "0.045",
    termYears: 20,
    originalLoanAmount: "260000",
    firstPaymentDate: "2023-01-01",
    propertyValuePurchase: "350000",
    propertyValueEstimated: "420000",
    usePurchaseOrEstimated: "estimated",
  },
];

const mockExtraPayments = [
  {
    id: 10,
    loanId: 2,
    paymentDate: "2024-06-01",
    startDate: null,
    endDate: null,
    amount: "5000",
    isActual: true,
    notes: "Bonus",
  },
];

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      settings: {
        mortgageLoans: { invalidate: invalidateLoans },
        mortgageExtraPayments: { invalidate: invalidateExtras },
      },
    }),
    settings: {
      mortgageLoans: {
        list: { useQuery: () => ({ data: mockLoans, isLoading: false }) },
        create: {
          useMutation: (opts: { onSuccess?: () => void }) => ({
            mutate: (input: unknown) => {
              createLoanMutate(input);
              opts.onSuccess?.();
            },
            isPending: false,
          }),
        },
        update: {
          useMutation: (opts: { onSuccess?: () => void }) => ({
            mutate: (input: unknown) => {
              updateLoanMutate(input);
              opts.onSuccess?.();
            },
            isPending: false,
          }),
        },
        delete: {
          useMutation: (opts: { onSuccess?: () => void }) => ({
            mutate: (input: unknown) => {
              deleteLoanMutate(input);
              opts.onSuccess?.();
            },
          }),
        },
      },
      mortgageExtraPayments: {
        list: { useQuery: () => ({ data: mockExtraPayments }) },
        create: {
          useMutation: (opts: { onSuccess?: () => void }) => ({
            mutate: (input: unknown) => {
              createExtraMutate(input);
              opts.onSuccess?.();
            },
            isPending: false,
          }),
        },
        delete: {
          useMutation: (opts: { onSuccess?: () => void }) => ({
            mutate: (input: unknown) => {
              deleteExtraMutate(input);
              opts.onSuccess?.();
            },
          }),
        },
      },
    },
  },
}));

import { MortgageSettings } from "@/components/mortgage/mortgage-settings";

describe("MortgageSettings smoke", () => {
  beforeEach(() => {
    currentRole = "admin";
    createLoanMutate.mockClear();
    updateLoanMutate.mockClear();
    deleteLoanMutate.mockClear();
    createExtraMutate.mockClear();
    deleteExtraMutate.mockClear();
  });

  it("renders loan cards, refinance chain, and extra payments table", () => {
    render(<MortgageSettings />);
    expect(screen.getByText("Mortgage Loans")).toBeInTheDocument();
    expect(screen.getByText("Refinance Chain")).toBeInTheDocument();
    expect(screen.getAllByText("Original 30yr").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Refi 20yr").length).toBeGreaterThan(0);
    expect(screen.getByText("Extra Payments")).toBeInTheDocument();
    expect(screen.getByText("Bonus")).toBeInTheDocument();
  });

  it("shows refinanced-from note on the loan that has a refinancedFromId", () => {
    render(<MortgageSettings />);
    expect(
      screen.getByText(/Refinanced from: Original 30yr/),
    ).toBeInTheDocument();
  });

  it("hides admin edit/delete/add affordances for a viewer", () => {
    currentRole = "viewer";
    render(<MortgageSettings />);
    expect(screen.queryByText("+ Add Loan")).toBeNull();
    expect(screen.queryByText("+ Add Extra Payment")).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("opens the add-loan form and creates a loan on Save", () => {
    render(<MortgageSettings />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add Loan" }));
    expect(screen.getByText("New Loan")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("e.g. Primary 30yr"), {
      target: { value: "New Loan Name" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(createLoanMutate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "New Loan Name" }),
    );
  });

  it("deletes a loan after confirming", async () => {
    render(<MortgageSettings />);
    const deleteButtons = screen.getAllByRole("button", { name: "Delete" });
    fireEvent.click(deleteButtons[0]!);
    await Promise.resolve();
    await Promise.resolve();
    expect(deleteLoanMutate).toHaveBeenCalled();
  });

  it("shows 'No loans configured' when there are no loans", () => {
    mockLoans.length = 0;
    render(<MortgageSettings />);
    expect(screen.getByText("No loans configured.")).toBeInTheDocument();
    // Restore for subsequent tests via re-push (splice-based mutation above
    // only affects this test's render since data is read fresh each render;
    // re-seed is handled by module reset between files).
    mockLoans.push(
      {
        id: 1,
        name: "Original 30yr",
        isActive: false,
        refinancedFromId: null,
        principalAndInterest: "1770.09",
        pmi: "0",
        insuranceAndTaxes: "400",
        totalEscrow: "400",
        interestRate: "0.065",
        termYears: 30,
        originalLoanAmount: "280000",
        firstPaymentDate: "2020-01-01",
        propertyValuePurchase: "350000",
        propertyValueEstimated: null,
        usePurchaseOrEstimated: "purchase",
      },
      {
        id: 2,
        name: "Refi 20yr",
        isActive: true,
        refinancedFromId: 1,
        principalAndInterest: "1600.00",
        pmi: "0",
        insuranceAndTaxes: "400",
        totalEscrow: "400",
        interestRate: "0.045",
        termYears: 20,
        originalLoanAmount: "260000",
        firstPaymentDate: "2023-01-01",
        propertyValuePurchase: "350000",
        propertyValueEstimated: "420000",
        usePurchaseOrEstimated: "estimated",
      },
    );
  });
});
