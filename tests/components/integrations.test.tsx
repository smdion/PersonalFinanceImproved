import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import * as staticTrpcMock from "./trpc-mock";
import type { MockOutput } from "./trpc-mock";

// Mock tRPC before importing the component
// Mock tRPC before importing the component
vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./trpc-mock")).trpc,
}));

type TrpcMock = typeof import("./trpc-mock");

/** Every test's tRPC unless it says otherwise: nothing connected, and no
 *  write settles (none of these tests writes). */
function defaults(m: TrpcMock) {
  m.resetTrpcMock();
  m.setQuery("settings.appSettings.list", []);
  // `isConnected` isn't the output's field (`connected`): kept as the test
  // had it; the card reads both services as not connected either way.
  m.setQuery("sync.getConnection", {
    ynab: { isConnected: false, lastSyncedAt: null },
    actual: { isConnected: false, lastSyncedAt: null },
  } as MockOutput<"sync.getConnection">);
  m.setQuery("sync.getSyncStatus", null);
  m.setQuery("sync.getPreview", null);
  m.setQuery("sec.getStatus", { connected: false });
  m.setQuery("tiingo.getStatus", { connected: false, lastSyncedAt: null });
  m.setQuery("simplefin.getStatus", { connected: false, lastSyncedAt: null });
  for (const path of [
    "settings.taxDataSync.setEnabled",
    "settings.taxDataSync.checkNow",
    "settings.taxDataSync.approve",
    "settings.taxDataSync.dismiss",
    "settings.appSettings.upsert",
    "sync.saveConnection",
    "sync.testConnection",
    "sync.updateActualExternalUrl",
    "sync.fetchYnabBudgets",
    "sync.deleteConnection",
    "sync.syncAll",
    "sync.setActiveBudgetApi",
    "tiingo.saveKey",
    "tiingo.testConnection",
    "tiingo.removeConnection",
    "simplefin.setLoanLink",
    "simplefin.saveToken",
    "simplefin.testConnection",
    "simplefin.syncNow",
    "simplefin.removeConnection",
    "simplefin.setAccountIncluded",
    "simplefin.setAccountMapping",
    "simplefin.acceptLinkSuggestions",
  ] as const)
    m.holdMutation(path);
}

vi.mock("@/lib/context/user-context", () => ({
  useUser: () => ({ role: "admin" }),
  isAdmin: () => true,
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({
    children,
    title,
  }: {
    children: React.ReactNode;
    title?: string;
  }) => (
    <div data-testid="card">
      {title && <h3>{title}</h3>}
      {children}
    </div>
  ),
}));

vi.mock("@/components/settings/integrations-sec", () => ({
  SecCard: () => <div data-testid="sec-card" />,
}));
vi.mock("@/components/settings/integrations-preview-panel", () => ({
  PreviewPanel: () => <div data-testid="preview-panel">Preview</div>,
}));

describe("IntegrationsSettings", () => {
  it("renders when user is admin", async () => {
    defaults(staticTrpcMock);
    const { IntegrationsSettings } =
      await import("@/components/settings/integrations");
    render(<IntegrationsSettings />);
    // "YNAB" appears twice — the left-nav item and the ServiceCard's own
    // title — both connection cards stay mounted at all times (only
    // visibility toggles) so their local state survives switching nav
    // sections; getAllByText confirms both rather than picking one.
    expect(screen.getAllByText("YNAB").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Actual Budget").length).toBeGreaterThan(0);
  });

  it("shows not-admin message for non-admin users", async () => {
    // Override mock to return non-admin
    vi.doMock("@/lib/context/user-context", () => ({
      useUser: () => ({ role: "viewer" }),
      isAdmin: () => false,
    }));

    // Clear module cache to pick up new mock
    vi.resetModules();

    // Re-mock dependencies that will be re-imported
    vi.doMock("@/lib/trpc", async () => ({
      trpc: (await import("./trpc-mock")).trpc,
    }));
    // After resetModules: the instance the re-imported component gets.
    const trpcMock = await import("./trpc-mock");
    defaults(trpcMock);

    vi.doMock("@/components/ui/card", () => ({
      Card: ({
        children,
        title,
      }: {
        children: React.ReactNode;
        title?: string;
      }) => (
        <div data-testid="card">
          {title && <h3>{title}</h3>}
          {children}
        </div>
      ),
    }));

    vi.doMock("@/components/settings/integrations-preview-panel", () => ({
      PreviewPanel: () => <div data-testid="preview-panel">Preview</div>,
    }));

    const { IntegrationsSettings } =
      await import("@/components/settings/integrations");
    render(<IntegrationsSettings />);
    expect(
      screen.getByText(/can only be configured by an admin/i),
    ).toBeInTheDocument();
  });

  // A service with a real saved connection that has never completed a
  // sync silently had NO way to activate it --
  // the Activate button (the only control that changes the active
  // provider) is gated on getPreview's `synced` flag, which is false
  // until a sync has run at least once, with zero explanation for why
  // the button was missing.
  it("shows a 'Sync Now to enable activation' hint instead of silently hiding Activate when connected-but-never-synced", async () => {
    vi.resetModules();

    vi.doMock("@/lib/context/user-context", () => ({
      useUser: () => ({ role: "admin" }),
      isAdmin: () => true,
    }));

    vi.doMock("@/lib/trpc", async () => ({
      trpc: (await import("./trpc-mock")).trpc,
    }));
    // After resetModules: the instance the re-imported component gets.
    const trpcMock = await import("./trpc-mock");
    defaults(trpcMock);
    // Active provider is YNAB; Actual has a real saved connection
    // (matches the live-DB finding: config present, last_synced_at
    // NULL) but was never synced.
    // lastSyncedAt is the ISO string the procedure returns (the card wraps it
    // in new Date(), so this renders as the Date the test had before).
    trpcMock.setQuery("sync.getConnection", {
      activeApi: "ynab",
      ynab: { connected: true, lastSyncedAt: new Date().toISOString() },
      actual: { connected: true, lastSyncedAt: null },
    });
    // Only the "actual" service's preview is relevant here -- never
    // synced, so getPreview's real server behavior is `{ synced: false }`.
    trpcMock.setQuery(
      "sync.getPreview",
      ({ service }: { service: string }) =>
        (service === "actual"
          ? { synced: false }
          : { synced: true, accounts: [] }) as MockOutput<"sync.getPreview">,
    );

    vi.doMock("@/components/ui/card", () => ({
      Card: ({
        children,
        title,
      }: {
        children: React.ReactNode;
        title?: string;
      }) => (
        <div data-testid="card">
          {title && <h3>{title}</h3>}
          {children}
        </div>
      ),
    }));

    vi.doMock("@/components/settings/integrations-preview-panel", () => ({
      PreviewPanel: () => <div data-testid="preview-panel">Preview</div>,
    }));

    const { IntegrationsSettings } =
      await import("@/components/settings/integrations");
    render(<IntegrationsSettings />);

    // The Actual Budget card: connected, not active, never synced.
    expect(
      screen.getByText("Sync Now to enable activation"),
    ).toBeInTheDocument();
    // No Activate button should be present for a never-synced connection.
    expect(screen.queryByText("Activate")).not.toBeInTheDocument();
    // YNAB is active and synced -- shows Deactivate, no hint.
    expect(screen.getByText("Deactivate")).toBeInTheDocument();
  });

  it("nav switches the visible section while keeping connection cards mounted, and shows status dots", async () => {
    vi.resetModules();

    vi.doMock("@/lib/context/user-context", () => ({
      useUser: () => ({ role: "admin" }),
      isAdmin: () => true,
    }));

    vi.doMock("@/lib/trpc", async () => ({
      trpc: (await import("./trpc-mock")).trpc,
    }));
    // After resetModules: the instance the re-imported component gets.
    const trpcMock = await import("./trpc-mock");
    defaults(trpcMock);
    // lastSyncedAt is the ISO string the procedure returns (the card wraps it
    // in new Date(), so this renders as the Date the test had before).
    trpcMock.setQuery("sync.getConnection", {
      activeApi: "ynab",
      ynab: { connected: true, lastSyncedAt: new Date().toISOString() },
      actual: { connected: false, lastSyncedAt: null },
    });

    trpcMock.setQuery("simplefin.getStatus", {
      connected: true,
      lastSyncedAt: null,
    });

    vi.doMock("@/components/ui/card", () => ({
      Card: ({
        children,
        title,
      }: {
        children: React.ReactNode;
        title?: string;
      }) => (
        <div data-testid="card">
          {title && <h3>{title}</h3>}
          {children}
        </div>
      ),
    }));

    vi.doMock("@/components/settings/integrations-preview-panel", () => ({
      PreviewPanel: () => <div data-testid="preview-panel">Preview</div>,
    }));

    const { fireEvent } = await import("@testing-library/react");
    const { IntegrationsSettings } =
      await import("@/components/settings/integrations");
    render(<IntegrationsSettings />);

    // Default section is YNAB.
    const ynabCardTitle = screen
      .getAllByText("YNAB")
      .find((el) => el.tagName === "H3")!;
    expect(ynabCardTitle.closest("div")).toBeVisible();

    // Switch to Sync Behavior — it only mounts when active.
    fireEvent.click(screen.getByText("Sync Behavior"));
    expect(screen.getByText("Auto-sync on page load")).toBeInTheDocument();

    // YNAB's card content is still in the DOM (mounted, not unmounted) —
    // just hidden — since its local state must survive nav switches.
    const ynabCardAfterSwitch = screen
      .getAllByText("YNAB")
      .find((el) => el.tagName === "H3")!;
    expect(ynabCardAfterSwitch).toBeInTheDocument();
  });
});
