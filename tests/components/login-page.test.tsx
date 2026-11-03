/**
 * The login page reads AUTH_AUTHENTIK_ISSUER per request (after
 * `connection()`), so one loaded module follows the running server's
 * setting: the Authentik button appears exactly when an issuer is set.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/server", () => ({ connection: vi.fn(async () => {}) }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next-auth/react", () => ({ signIn: vi.fn() }));

import { connection } from "next/server";
import LoginPage from "@/app/login/page";

const authentikButton = () =>
  screen.queryByRole("button", { name: /Sign in with Authentik/i });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("LoginPage", () => {
  it("offers Authentik only while the server has an issuer, read per request", async () => {
    vi.stubEnv("AUTH_AUTHENTIK_ISSUER", "");
    const first = render(await LoginPage());
    expect(authentikButton()).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    first.unmount();

    vi.stubEnv(
      "AUTH_AUTHENTIK_ISSUER",
      "https://auth.example.test/application/o/ledgr/",
    );
    render(await LoginPage());
    expect(authentikButton()).toBeInTheDocument();
    expect(connection).toHaveBeenCalledTimes(2);
  });
});
