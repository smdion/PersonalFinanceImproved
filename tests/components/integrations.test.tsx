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
    }),
    sync: {
      getConnection: {
        useQuery: () => ({
          data: {
            ynab: { isConnected: false, lastSyncedAt: null },
            actual: { isConnected: false, lastSyncedAt: null },
          },
        }),
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
        sync: {
          getConnection: {
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
});
