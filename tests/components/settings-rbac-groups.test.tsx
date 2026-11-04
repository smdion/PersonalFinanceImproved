import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Smoke tests for src/components/settings/rbac-groups.tsx — RBAC group
// mapping settings tab. Zero prior coverage of src/components/settings/
// outside the integrations/ subfolder (already covered separately).
// Follows the leaf-component smoke pattern established in
// tests/components/networth-sections-smoke.test.tsx: mock tRPC directly
// with representative query/mutation shapes.

const mockData = {
  adminGroup: "ledgr-admin",
  isAdminCustom: false,
  permissions: [
    {
      permission: "scenario" as const,
      group: "ledgr-scenario",
      isCustom: false,
    },
    {
      permission: "portfolio" as const,
      group: "ledgr-portfolio",
      isCustom: false,
    },
    {
      permission: "budget" as const,
      group: "custom-budget-group",
      isCustom: true,
    },
  ],
};

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./trpc-mock")).trpc,
}));

import { RbacGroupsSettings } from "@/components/settings/rbac-groups";
import { mutationCalls, resetTrpcMock, setQuery } from "./trpc-mock";

describe("RbacGroupsSettings smoke", () => {
  beforeEach(() => {
    resetTrpcMock();
    setQuery("settings.rbacGroups.get", mockData);
  });

  it("renders setup instructions and group mapping inputs", () => {
    render(<RbacGroupsSettings />);
    // The Authentik OIDC provider walkthrough moved to AuthSettings (Access
    // Control's own Authentik section) — see settings-auth-settings.test.tsx
    // — RbacGroupsSettings now only covers RBAC-specific setup.
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
      expect(mutationCalls("settings.appSettings.upsert")).toContainEqual({
        key: "rbac_admin_group",
        value: "custom-admins",
      }),
    );
    await waitFor(() =>
      expect(mutationCalls("settings.appSettings.delete")).toContainEqual({
        key: "rbac_group_budget",
      }),
    );
  });

  it("resets all fields to defaults when Reset to Defaults is clicked", () => {
    render(<RbacGroupsSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Reset to Defaults" }));
    expect(screen.getByDisplayValue("ledgr-admin")).toBeInTheDocument();
    expect(screen.getByDisplayValue("ledgr-budget")).toBeInTheDocument();
  });
});
