import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Smoke tests for src/components/settings/auth-settings.tsx — Authentik
// OIDC connection status/test UI. Part of closing the zero-coverage gap on
// src/components/settings/ (RBAC/credentials/limits) outside the
// integrations/ subfolder (covered elsewhere).

let queryResult: {
  configured: boolean;
  reachable: boolean;
  issuer?: string;
} | null = null;
const isFetching = false;
const refetch = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    settings: {
      testOidcConnection: {
        useQuery: (_input: unknown, opts: { enabled: boolean }) => ({
          data: opts.enabled ? queryResult : undefined,
          isFetching,
          refetch,
        }),
      },
    },
  },
}));

import { AuthSettings } from "@/components/settings/auth-settings";

describe("AuthSettings smoke", () => {
  it("renders required env vars and local admin info without testing yet", () => {
    render(<AuthSettings />);
    expect(screen.getByText("Authentik (OIDC)")).toBeInTheDocument();
    expect(screen.getByText("AUTH_AUTHENTIK_ISSUER")).toBeInTheDocument();
    expect(screen.getByText("AUTH_AUTHENTIK_ID")).toBeInTheDocument();
    expect(screen.getByText("AUTH_AUTHENTIK_SECRET")).toBeInTheDocument();
    expect(screen.getByText("Local Admin")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Test Connection" }),
    ).toBeInTheDocument();
  });

  it("shows 'Connected' when configured and reachable after testing", async () => {
    queryResult = {
      configured: true,
      reachable: true,
      issuer: "https://auth.example.com/application/o/ledgr/",
    };
    render(<AuthSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Test Connection" }));
    await waitFor(() => {
      expect(
        screen.getByText(/Connected \(https:\/\/auth\.example\.com/),
      ).toBeInTheDocument();
    });
  });

  it("shows 'Configured but unreachable' when configured but not reachable", async () => {
    queryResult = { configured: true, reachable: false };
    render(<AuthSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Test Connection" }));
    await waitFor(() => {
      expect(
        screen.getByText("Configured but unreachable"),
      ).toBeInTheDocument();
    });
  });

  it("shows 'Not configured' when Authentik env vars are unset", async () => {
    queryResult = { configured: false, reachable: false };
    render(<AuthSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Test Connection" }));
    await waitFor(() => {
      expect(screen.getByText("Not configured")).toBeInTheDocument();
    });
  });
});
