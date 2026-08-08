import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BrokerageGoalsSection } from "@/components/cards/brokerage-goals";

// Smoke test for BrokerageGoalsSection — covers the loading state, the
// mutation path (create goal), and the permission gate (canEdit via
// hasPermission("brokerage")): viewers should not see Edit/Delete/Add
// controls, admins should.

let mockRole: "admin" | "viewer" = "admin";
vi.mock("@/lib/context/user-context", () => ({
  useUser: () => ({ role: mockRole, permissions: [] }),
  hasPermission: (user: { role: string; permissions: string[] }, p: string) =>
    user.role === "admin" || user.permissions.includes(p),
}));

vi.mock("@/components/ui/confirm-dialog", () => ({
  confirm: vi.fn(async () => true),
}));

// HelpTip renders a Radix Tooltip, which needs a TooltipProvider ancestor
// this component doesn't supply on its own. Stub it out like other tests do.
vi.mock("@/components/ui/help-tip", () => ({ HelpTip: () => null }));

const createMutate = vi.fn();
const invalidateGoals = vi.fn();
const invalidateSummary = vi.fn();
let goalsQueryData: unknown[] | undefined;
let goalsLoading = false;

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      brokerage: {
        listGoals: { invalidate: invalidateGoals },
        computeSummary: { invalidate: invalidateSummary },
      },
    }),
    brokerage: {
      listGoals: {
        useQuery: () => ({ data: goalsQueryData, isLoading: goalsLoading }),
      },
      createGoal: {
        useMutation: ({ onSuccess }: { onSuccess?: () => void }) => ({
          mutate: (input: unknown) => {
            createMutate(input);
            onSuccess?.();
          },
          isPending: false,
        }),
      },
      updateGoal: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      deleteGoal: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
  },
}));

const mockGoals = [
  {
    id: 1,
    name: "New Car",
    targetAmount: 30000,
    targetYear: 2028,
    priority: 0,
    isActive: true,
    notes: null,
  },
];

describe("BrokerageGoalsSection", () => {
  beforeEach(() => {
    createMutate.mockClear();
    invalidateGoals.mockClear();
    invalidateSummary.mockClear();
    mockRole = "admin";
    goalsQueryData = mockGoals;
    goalsLoading = false;
  });

  it("renders a loading skeleton while goals are loading", () => {
    goalsLoading = true;
    render(<BrokerageGoalsSection />);
    expect(screen.getByText("Long-Term Goals")).toBeInTheDocument();
  });

  it("renders without crashing and shows existing goals", () => {
    render(<BrokerageGoalsSection />);
    expect(screen.getByText("New Car")).toBeInTheDocument();
    expect(screen.getAllByText("$30,000.00").length).toBeGreaterThan(0);
    expect(screen.getByText("Total Commitments")).toBeInTheDocument();
  });

  it("shows the empty state when there are no goals and the create form is closed", () => {
    goalsQueryData = [];
    render(<BrokerageGoalsSection />);
    expect(
      screen.getByText(
        "No long-term goals yet. Add a goal to start tracking brokerage-funded purchases.",
      ),
    ).toBeInTheDocument();
  });

  it("admin: shows Edit/Delete controls and the Add Goal button (permission-gated)", () => {
    mockRole = "admin";
    render(<BrokerageGoalsSection />);
    expect(screen.getByText("Edit")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
    expect(screen.getByText("+ Add Long-Term Goal")).toBeInTheDocument();
  });

  it("viewer: hides Edit/Delete controls and the Add Goal button (permission-gated)", () => {
    mockRole = "viewer";
    render(<BrokerageGoalsSection />);
    expect(screen.queryByText("Edit")).toBeNull();
    expect(screen.queryByText("Delete")).toBeNull();
    expect(screen.queryByText("+ Add Long-Term Goal")).toBeNull();
  });

  it("submits a new goal through the createGoal mutation", () => {
    render(<BrokerageGoalsSection />);

    fireEvent.click(screen.getByText("+ Add Long-Term Goal"));

    fireEvent.change(screen.getByPlaceholderText("Goal name (e.g., New Car)"), {
      target: { value: "Kitchen Remodel" },
    });
    fireEvent.change(screen.getByPlaceholderText("Target amount"), {
      target: { value: "50000" },
    });
    fireEvent.change(screen.getByPlaceholderText("Target year"), {
      target: { value: "2030" },
    });

    fireEvent.click(screen.getByText("Create Goal"));

    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Kitchen Remodel",
        targetAmount: "50000",
        targetYear: 2030,
      }),
    );
  });
});
