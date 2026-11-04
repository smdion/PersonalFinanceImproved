import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Smoke tests for src/components/settings/access-control.tsx — the shell
// that consolidates Auth (Authentik OIDC connection) and RBAC (group ->
// permission mapping) behind one left-column sub-nav. Both children
// (AuthSettings, RbacGroupsSettings) already have their own dedicated
// smoke tests unchanged by this consolidation — this file only covers the
// shell's own behavior: default section, nav switching, persistence key.

const { store } = vi.hoisted(() => ({ store: new Map<string, unknown>() }));

// Stateful in-memory usePersistedSetting (via real useState) so nav
// clicks actually trigger a re-render — a mock that just wrote to a plain
// Map without useState would silently no-op every click.
vi.mock("@/lib/hooks/use-persisted-setting", () => ({
  usePersistedSetting: <T,>(key: string, initial: T) => {
    const [value, setValue] = React.useState<T>(
      (store.has(key) ? store.get(key) : initial) as T,
    );
    const set = (v: T) => {
      store.set(key, v);
      setValue(v);
    };
    return [value, set];
  },
}));

const mockRbacData = {
  adminGroup: "ledgr-admin",
  isAdminCustom: false,
  permissions: [
    {
      permission: "scenario" as const,
      group: "ledgr-scenario",
      isCustom: false,
    },
  ],
};

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./trpc-mock")).trpc,
}));

import { AccessControlSettings } from "@/components/settings/access-control";
import { holdMutation, resetTrpcMock, setQuery } from "./trpc-mock";

describe("AccessControlSettings smoke", () => {
  beforeEach(() => {
    store.clear();
    resetTrpcMock();
    setQuery("settings.rbacGroups.get", mockRbacData);
    // Writes never settled before (no onSuccess): keep it so.
    holdMutation("settings.appSettings.upsert");
    holdMutation("settings.appSettings.delete");
  });

  it("defaults to the Authentik section", () => {
    render(<AccessControlSettings />);
    expect(screen.getByText("Authentik (OIDC)")).toBeInTheDocument();
  });

  it("switches to RBAC Groups via the left nav", () => {
    render(<AccessControlSettings />);
    // "RBAC Groups" also appears inside AuthSettings' own intro text (a
    // pointer to this section) — scope to the nav button specifically.
    fireEvent.click(screen.getByRole("button", { name: "RBAC Groups" }));
    expect(screen.getByText("Authentik Group Mapping")).toBeInTheDocument();
    expect(screen.queryByText("Authentik (OIDC)")).toBeNull();
  });
});
