import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { mutationCalls, resetTrpcMock, utilsCalls } from "./trpc-mock";

// Utilities ▸ add a utility (src/components/upkeep/add-utility-form.tsx):
// a household starting from nothing can add a service; each kind once;
// admins only (upsertService is an admin procedure).

let currentRole: "admin" | "viewer" = "admin";

vi.mock("@/lib/context/user-context", () => ({
  useUser: () => ({ role: currentRole, name: "Test", permissions: [] }),
  isAdmin: (u: { role: string }) => u.role === "admin",
}));

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./trpc-mock")).trpc,
}));

import { AddUtilityForm } from "@/components/upkeep/add-utility-form";

describe("AddUtilityForm", () => {
  beforeEach(() => {
    currentRole = "admin";
    resetTrpcMock();
  });

  it("adds the first utility with its usual unit", () => {
    render(<AddUtilityForm existingKinds={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add a utility" }));
    fireEvent.change(screen.getByPlaceholderText("Who bills you"), {
      target: { value: "Example Gas Co" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(mutationCalls("utilities.upsertService")).toEqual([
      {
        kind: "gas",
        providerName: "Example Gas Co",
        usageUnit: "ccf",
      },
    ]);
    expect(utilsCalls("utilities.invalidate")).not.toHaveLength(0);
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
