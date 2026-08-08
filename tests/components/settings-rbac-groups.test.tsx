import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Smoke tests for src/components/settings/rbac-groups.tsx — RBAC group
// mapping settings tab. Zero prior coverage of src/components/settings/
// outside the integrations/ subfolder (already covered separately).
// Follows the leaf-component smoke pattern established in
// tests/components/networth-sections-smoke.test.tsx: mock tRPC directly
// with representative query/mutation shapes.

const upsertMutate = vi.fn();
const deleteMutate = vi.fn();
const invalidateRbac = vi.fn();
const invalidateList = vi.fn();

const mockData = {
  adminGroup: "ledgr-admin",
  isAdminCustom: false,
  permissions: [
    { permission: "scenario", group: "ledgr-scenario", isCustom: false },
    { permission: "portfolio", group: "ledgr-portfolio", isCustom: false },
    { permission: "budget", group: "custom-budget-group", isCustom: true },
  ],
};

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      settings: {
        rbacGroups: { get: { invalidate: invalidateRbac } },
        appSettings: { list: { invalidate: invalidateList } },
      },
    }),
    settings: {
      rbacGroups: {
        get: {
          useQuery: () => ({ data: mockData, isLoading: false }),
        },
      },
      appSettings: {
        upsert: {
          useMutation: (opts: { onSuccess?: () => void }) => ({
            mutateAsync: async (input: unknown) => {
              upsertMutate(input);
              opts.onSuccess?.();
            },
          }),
        },
        delete: {
          useMutation: (opts: { onSuccess?: () => void }) => ({
            mutateAsync: async (input: unknown) => {
              deleteMutate(input);
              opts.onSuccess?.();
            },
          }),
        },
      },
    },
  },
}));

import { RbacGroupsSettings } from "@/components/settings/rbac-groups";

describe("RbacGroupsSettings smoke", () => {
  beforeEach(() => {
    upsertMutate.mockClear();
    deleteMutate.mockClear();
  });

  it("renders setup instructions and group mapping inputs", () => {
    render(<RbacGroupsSettings />);
    expect(
      screen.getByText("Authentik OIDC Provider Setup"),
    ).toBeInTheDocument();
    expect(screen.getByText("RBAC Group Setup")).toBeInTheDocument();
    expect(screen.getByText("Authentik Group Mapping")).toBeInTheDocument();
    expect(screen.getByDisplayValue("ledgr-admin")).toBeInTheDocument();
    expect(screen.getByDisplayValue("ledgr-scenario")).toBeInTheDocument();
  });

  it("flags a permission row as custom when isCustom is true", () => {
    render(<RbacGroupsSettings />);
    expect(screen.getByText("custom")).toBeInTheDocument();
  });

  it("disables Save until a field is edited (dirty tracking)", () => {
    render(<RbacGroupsSettings />);
    const saveButton = screen.getByRole("button", { name: "Save" });
    expect(saveButton).toBeDisabled();

    const adminInput = screen.getByDisplayValue("ledgr-admin");
    fireEvent.change(adminInput, { target: { value: "custom-admins" } });
    expect(saveButton).not.toBeDisabled();
  });

  it("upserts changed groups and deletes custom groups reset to default on save", async () => {
    render(<RbacGroupsSettings />);

    // Edit admin group (differs from default "ledgr-admin")
    fireEvent.change(screen.getByDisplayValue("ledgr-admin"), {
      target: { value: "custom-admins" },
    });
    // Reset the custom "budget" group back to its default value so the
    // save path exercises the delete-custom-setting branch.
    fireEvent.change(screen.getByDisplayValue("custom-budget-group"), {
      target: { value: "ledgr-budget" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(upsertMutate).toHaveBeenCalledWith({
        key: "rbac_admin_group",
        value: "custom-admins",
      }),
    );
    await waitFor(() =>
      expect(deleteMutate).toHaveBeenCalledWith({ key: "rbac_group_budget" }),
    );
  });

  it("resets all fields to defaults when Reset to Defaults is clicked", () => {
    render(<RbacGroupsSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Reset to Defaults" }));
    expect(screen.getByDisplayValue("ledgr-admin")).toBeInTheDocument();
    expect(screen.getByDisplayValue("ledgr-budget")).toBeInTheDocument();
  });
});
