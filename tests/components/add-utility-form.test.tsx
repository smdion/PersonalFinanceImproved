import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Utilities ▸ add a utility (src/components/upkeep/add-utility-form.tsx):
// a household starting from nothing can add a service; each kind once;
// admins only (upsertService is an admin procedure).

let currentRole: "admin" | "viewer" = "admin";

vi.mock("@/lib/context/user-context", () => ({
  useUser: () => ({ role: currentRole, name: "Test", permissions: [] }),
  isAdmin: (u: { role: string }) => u.role === "admin",
}));

const upsertMutate = vi.fn();
const invalidate = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ utilities: { invalidate } }),
    utilities: {
      upsertService: {
        useMutation: (opts: { onSuccess?: () => void }) => ({
          mutate: (input: unknown) => {
            upsertMutate(input);
            opts.onSuccess?.();
          },
          isPending: false,
          error: null,
        }),
      },
    },
  },
}));

import { AddUtilityForm } from "@/components/upkeep/add-utility-form";

describe("AddUtilityForm", () => {
  beforeEach(() => {
    currentRole = "admin";
    upsertMutate.mockClear();
    invalidate.mockClear();
  });

  it("adds the first utility with its usual unit", () => {
    render(<AddUtilityForm existingKinds={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add a utility" }));
    fireEvent.change(screen.getByPlaceholderText("Who bills you"), {
      target: { value: "Example Gas Co" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(upsertMutate).toHaveBeenCalledWith({
      kind: "gas",
      providerName: "Example Gas Co",
      usageUnit: "ccf",
    });
    expect(invalidate).toHaveBeenCalled();
  });

  it("offers only the kinds not added yet", () => {
    render(<AddUtilityForm existingKinds={["gas", "water"]} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add a utility" }));
    const options = screen
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value);
    expect(options).toContain("electric");
    expect(options).not.toContain("gas");
    expect(options).not.toContain("water");
  });

  it("hides when every kind is added, and for viewers", () => {
    const { container, rerender } = render(
      <AddUtilityForm existingKinds={["gas", "water", "electric"]} />,
    );
    expect(container).toBeEmptyDOMElement();
    currentRole = "viewer";
    rerender(<AddUtilityForm existingKinds={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
