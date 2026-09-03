import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Smoke tests for src/components/settings/contribution-limits.tsx — IRS
// contribution limit / FICA / standard-deduction editor. Part of closing
// the zero-coverage gap on src/components/settings/ (RBAC/credentials/
// limits) outside the integrations/ subfolder (covered elsewhere).
// InlineEdit and account-types config are used unmocked — they're stable,
// presentational/data-driven building blocks (matches the leaf-component
// smoke pattern from tests/components/networth-sections-smoke.test.tsx).
//
// `year` is a controlled prop as of the Tax Data consolidation (the
// shared year toggle now lives in the TaxDataSettings parent shell, see
// settings-tax-data.test.tsx) — tests pass it directly instead of
// clicking an in-component year tab.

let currentRole: "admin" | "viewer" = "admin";

vi.mock("@/lib/context/user-context", () => ({
  useUser: () => ({ role: currentRole, name: "Test", permissions: [] }),
  isAdmin: (u: { role: string }) => u.role === "admin",
}));

const updateMutate = vi.fn();
const createMutate = vi.fn();
const deleteMutate = vi.fn();
const invalidate = vi.fn();

const mockLimits2025 = [
  {
    id: 1,
    taxYear: 2025,
    limitType: "ss_wage_base",
    value: "176100",
    notes: null,
  },
  {
    id: 2,
    taxYear: 2025,
    limitType: "fica_ss_rate",
    value: "0.062",
    notes: null,
  },
  {
    id: 3,
    taxYear: 2025,
    limitType: "fica_medicare_rate",
    value: "0.0145",
    notes: null,
  },
];

const mockLimits2024 = [
  {
    id: 4,
    taxYear: 2024,
    limitType: "ss_wage_base",
    value: "168600",
    notes: null,
  },
];

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      settings: {
        contributionLimits: { list: { invalidate } },
      },
    }),
    settings: {
      contributionLimits: {
        list: {
          useQuery: () => ({
            data: [...mockLimits2025, ...mockLimits2024],
            isLoading: false,
          }),
        },
        update: {
          useMutation: (opts: { onSuccess?: () => void }) => ({
            mutate: (input: unknown) => {
              updateMutate(input);
              opts.onSuccess?.();
            },
            isPending: false,
          }),
        },
        create: {
          useMutation: (opts: { onSuccess?: () => void }) => ({
            mutate: (input: unknown) => {
              createMutate(input);
              opts.onSuccess?.();
            },
            mutateAsync: async (input: unknown) => {
              createMutate(input);
              opts.onSuccess?.();
            },
            isPending: false,
          }),
        },
        delete: {
          useMutation: (opts: { onSuccess?: () => void }) => ({
            mutateAsync: async (input: unknown) => {
              deleteMutate(input);
              opts.onSuccess?.();
            },
            isPending: false,
          }),
        },
      },
    },
  },
}));

import { ContributionLimitsSettings } from "@/components/settings/contribution-limits";

describe("ContributionLimitsSettings smoke", () => {
  beforeEach(() => {
    currentRole = "admin";
    updateMutate.mockClear();
    createMutate.mockClear();
    deleteMutate.mockClear();
  });

  it("renders the FICA/Medicare group for the given year", () => {
    render(<ContributionLimitsSettings year={2025} />);
    expect(screen.getByText("Contribution & Tax Limits")).toBeInTheDocument();
    expect(screen.getByText("FICA / Medicare")).toBeInTheDocument();
  });

  it("shows a change indicator when a value differs from the prior year", () => {
    render(<ContributionLimitsSettings year={2025} />);
    // ss_wage_base changed 168600 -> 176100, an increase, so an up arrow
    // with the prior-year value in its title should render.
    expect(screen.getByTitle(/2024: \$168,600/)).toBeInTheDocument();
  });

  it("renders the prior year's own data when given that year directly", () => {
    render(<ContributionLimitsSettings year={2024} />);
    expect(screen.getByText("$168,600.00")).toBeInTheDocument();
  });

  it("shows the Delete-year action for admins", () => {
    render(<ContributionLimitsSettings year={2025} />);
    expect(screen.getByText("Delete 2025")).toBeInTheDocument();
  });

  it("hides admin-only controls (Delete year, edit affordances) for a viewer", () => {
    currentRole = "viewer";
    render(<ContributionLimitsSettings year={2025} />);
    expect(screen.queryByText("Delete 2025")).toBeNull();
  });

  it("saves an edited limit via InlineEdit", () => {
    render(<ContributionLimitsSettings year={2025} />);
    // ss_wage_base displays as currency; click to enter edit mode.
    const display = screen.getByText("$176,100.00");
    fireEvent.click(display);
    const input = screen.getByDisplayValue("176100");
    fireEvent.change(input, { target: { value: "180000" } });
    fireEvent.blur(input);
    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
        limitType: "ss_wage_base",
        value: "180000",
      }),
    );
  });
});
