import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock tRPC before importing the component
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      sync: {
        getConnection: { invalidate: vi.fn() },
        getSyncStatus: { invalidate: vi.fn() },
        getActiveBudgetApi: { invalidate: vi.fn() },
        getPreview: { invalidate: vi.fn() },
      },
      simplefin: {
        getStatus: { invalidate: vi.fn() },
        listBalanceHistory: { invalidate: vi.fn() },
        listAccounts: { invalidate: vi.fn() },
      },
    }),
    settings: {
      appSettings: {
        upsert: {
          useMutation: () => ({ mutate: vi.fn(), isPending: false }),
        },
      },
    },
    sync: {
      getConnection: {
        useQuery: () => ({
          data: {
            ynab: { isConnected: false, lastSyncedAt: null },
            actual: { isConnected: false, lastSyncedAt: null },
          },
        }),
      },
      getSyncStatus: {
        useQuery: () => ({ data: null }),
      },
      getPreview: {
        useQuery: () => ({ data: null }),
      },
      getActiveBudgetApi: {
        useQuery: () => ({ data: { service: null } }),
      },
      saveConnection: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      testConnection: {
        useMutation: () => ({
          mutate: vi.fn(),
          isPending: false,
          isSuccess: false,
          data: null,
        }),
      },
      fetchYnabBudgets: {
        useMutation: () => ({
          mutate: vi.fn(),
          isPending: false,
          isSuccess: false,
          data: null,
        }),
      },
      deleteConnection: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      syncAll: {
        useMutation: () => ({
          mutate: vi.fn(),
          isPending: false,
          isSuccess: false,
          data: null,
        }),
      },
      setActiveBudgetApi: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
    simplefin: {
      getStatus: {
        useQuery: () => ({ data: { connected: false, lastSyncedAt: null } }),
      },
      listAccounts: {
        useQuery: () => ({ data: undefined }),
      },
      listMatchableAccounts: {
        useQuery: () => ({ data: undefined }),
      },
      saveToken: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      testConnection: {
        useMutation: () => ({
          mutate: vi.fn(),
          isPending: false,
          isSuccess: false,
          data: null,
        }),
      },
      syncNow: {
        useMutation: () => ({
          mutate: vi.fn(),
          isPending: false,
          isSuccess: false,
          isError: false,
          data: null,
        }),
      },
      removeConnection: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      setAccountIncluded: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      setAccountMapping: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
  },
}));

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

vi.mock("@/components/settings/integrations-preview-panel", () => ({
  PreviewPanel: () => <div data-testid="preview-panel">Preview</div>,
}));

describe("IntegrationsSettings", () => {
  it("renders when user is admin", async () => {
    const { IntegrationsSettings } =
      await import("@/components/settings/integrations");
    render(<IntegrationsSettings />);
    expect(screen.getByText("YNAB")).toBeInTheDocument();
    expect(screen.getByText("Actual Budget")).toBeInTheDocument();
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
    vi.doMock("@/lib/trpc", () => ({
      trpc: {
        useUtils: () => ({
          sync: {
            getConnection: { invalidate: vi.fn() },
            getSyncStatus: { invalidate: vi.fn() },
            getActiveBudgetApi: { invalidate: vi.fn() },
            getPreview: { invalidate: vi.fn() },
          },
        }),
        settings: {
          appSettings: {
            upsert: {
              useMutation: () => ({ mutate: vi.fn(), isPending: false }),
            },
          },
        },
        sync: {
          getConnection: {
            useQuery: () => ({ data: null }),
          },
          getSyncStatus: {
            useQuery: () => ({ data: null }),
          },
          getPreview: {
            useQuery: () => ({ data: null }),
          },
          getActiveBudgetApi: {
            useQuery: () => ({ data: { service: null } }),
          },
          saveConnection: {
            useMutation: () => ({ mutate: vi.fn(), isPending: false }),
          },
          testConnection: {
            useMutation: () => ({
              mutate: vi.fn(),
              isPending: false,
              isSuccess: false,
              data: null,
            }),
          },
          fetchYnabBudgets: {
            useMutation: () => ({
              mutate: vi.fn(),
              isPending: false,
              isSuccess: false,
              data: null,
            }),
          },
          deleteConnection: {
            useMutation: () => ({ mutate: vi.fn(), isPending: false }),
          },
          syncAll: {
            useMutation: () => ({
              mutate: vi.fn(),
              isPending: false,
              isSuccess: false,
              data: null,
            }),
          },
          setActiveBudgetApi: {
            useMutation: () => ({ mutate: vi.fn(), isPending: false }),
          },
        },
      },
    }));

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

  // Live-user finding, 2026-08-30: a service with a real saved connection
  // that has never completed a sync silently had NO way to activate it --
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

    vi.doMock("@/lib/trpc", () => ({
      trpc: {
        useUtils: () => ({
          sync: {
            getConnection: { invalidate: vi.fn() },
            getSyncStatus: { invalidate: vi.fn() },
            getActiveBudgetApi: { invalidate: vi.fn() },
            getPreview: { invalidate: vi.fn() },
          },
          savings: { invalidate: vi.fn() },
          budget: { invalidate: vi.fn() },
          assets: { invalidate: vi.fn() },
          simplefin: {
            getStatus: { invalidate: vi.fn() },
            listBalanceHistory: { invalidate: vi.fn() },
            listAccounts: { invalidate: vi.fn() },
          },
        }),
        settings: {
          appSettings: {
            upsert: {
              useMutation: () => ({ mutate: vi.fn(), isPending: false }),
            },
          },
        },
        sync: {
          getConnection: {
            // Active provider is YNAB; Actual has a real saved connection
            // (matches the live-DB finding: config present, last_synced_at
            // NULL) but was never synced.
            useQuery: () => ({
              data: {
                activeApi: "ynab",
                ynab: { connected: true, lastSyncedAt: new Date() },
                actual: { connected: true, lastSyncedAt: null },
              },
            }),
          },
          getSyncStatus: { useQuery: () => ({ data: null }) },
          getPreview: {
            // Only the "actual" service's preview is relevant here --
            // never synced, so getPreview's real server behavior is
            // `{ synced: false }`.
            useQuery: ({ service }: { service: string }) => ({
              data:
                service === "actual"
                  ? { synced: false }
                  : { synced: true, accounts: [] },
            }),
          },
          getActiveBudgetApi: {
            useQuery: () => ({ data: { service: "ynab" } }),
          },
          saveConnection: {
            useMutation: () => ({ mutate: vi.fn(), isPending: false }),
          },
          testConnection: {
            useMutation: () => ({
              mutate: vi.fn(),
              isPending: false,
              isSuccess: false,
              data: null,
            }),
          },
          fetchYnabBudgets: {
            useMutation: () => ({
              mutate: vi.fn(),
              isPending: false,
              isSuccess: false,
              data: null,
            }),
          },
          deleteConnection: {
            useMutation: () => ({ mutate: vi.fn(), isPending: false }),
          },
          syncAll: {
            useMutation: () => ({
              mutate: vi.fn(),
              isPending: false,
              isSuccess: false,
              isError: false,
              data: null,
            }),
          },
          setActiveBudgetApi: {
            useMutation: () => ({ mutate: vi.fn(), isPending: false }),
          },
        },
        simplefin: {
          getStatus: {
            useQuery: () => ({
              data: { connected: false, lastSyncedAt: null },
            }),
          },
          listAccounts: { useQuery: () => ({ data: undefined }) },
          listMatchableAccounts: { useQuery: () => ({ data: undefined }) },
          saveToken: {
            useMutation: () => ({ mutate: vi.fn(), isPending: false }),
          },
          testConnection: {
            useMutation: () => ({
              mutate: vi.fn(),
              isPending: false,
              isSuccess: false,
              data: null,
            }),
          },
          syncNow: {
            useMutation: () => ({
              mutate: vi.fn(),
              isPending: false,
              isSuccess: false,
              isError: false,
              data: null,
            }),
          },
          removeConnection: {
            useMutation: () => ({ mutate: vi.fn(), isPending: false }),
          },
          setAccountIncluded: {
            useMutation: () => ({ mutate: vi.fn(), isPending: false }),
          },
          setAccountMapping: {
            useMutation: () => ({ mutate: vi.fn(), isPending: false }),
          },
        },
      },
    }));

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
});
