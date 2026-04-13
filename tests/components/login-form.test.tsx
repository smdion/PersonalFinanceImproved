import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// The global tests/setup-component.ts mocks next/navigation with plain
// functions (not vi.fn()), which we can't chain mockReturnValue on. Override
// with a local mock that uses a reassignable ref so each test can set its
// own search params.
const searchParamsRef = { current: new URLSearchParams() };
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/",
  useSearchParams: () => searchParamsRef.current,
}));

vi.mock("next-auth/react", () => ({
  signIn: vi.fn(),
}));

import { signIn } from "next-auth/react";
import { LoginForm } from "@/app/login/login-form";

/**
 * LoginForm component contract (v0.5 expert-review M18).
 *
 * Pairs with tests/e2e/auth-flow.spec.ts — the e2e spec is skipped in
 * DEMO_ONLY mode because the demo session is auto-injected and /login
 * is unreachable, so this component test is the load-bearing coverage
 * for the login page contract in CI. It runs against the real LoginForm
 * with signIn + useSearchParams mocked, so any regression in the form
 * structure or error-handling path fails fast.
 *
 * The test covers:
 *   - Brand identity (heading + subtitle)
 *   - Email + password inputs present, labeled, required, with the
 *     right autocomplete attributes
 *   - Submit button renders and is enabled by default
 *   - OIDC button appears only when hasOidc={true}
 *   - Query-param error surfacing (CredentialsSignin → "Invalid …")
 *   - Invalid-credentials submission path: signIn returns {error}, the
 *     local error banner appears, and the form stays mounted (no
 *     redirect side-effect)
 */

describe("LoginForm (M18)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset search params ref to empty — individual tests override to
    // simulate ?error=... or ?callbackUrl=... query strings.
    searchParamsRef.current = new URLSearchParams();
  });

  describe("static structure", () => {
    it("renders the Ledgr brand heading + subtitle", () => {
      render(<LoginForm hasOidc={false} />);
      expect(
        screen.getByRole("heading", { name: "Ledgr", level: 1 }),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Personal Finance Dashboard"),
      ).toBeInTheDocument();
    });

    it("renders email + password inputs with correct attributes", () => {
      render(<LoginForm hasOidc={false} />);
      const email = screen.getByLabelText("Email") as HTMLInputElement;
      const password = screen.getByLabelText("Password") as HTMLInputElement;
      expect(email).toBeInTheDocument();
      expect(email.type).toBe("email");
      expect(email.required).toBe(true);
      expect(email.autocomplete).toBe("email");
      expect(password).toBeInTheDocument();
      expect(password.type).toBe("password");
      expect(password.required).toBe(true);
      expect(password.autocomplete).toBe("current-password");
    });

    it("renders an enabled submit button", () => {
      render(<LoginForm hasOidc={false} />);
      const submit = screen.getByRole("button", { name: "Sign in" });
      expect(submit).toBeInTheDocument();
      expect(submit).not.toBeDisabled();
    });

    it("hides the Authentik button when hasOidc is false", () => {
      render(<LoginForm hasOidc={false} />);
      expect(
        screen.queryByRole("button", { name: /Sign in with Authentik/i }),
      ).not.toBeInTheDocument();
    });

    it("shows the Authentik button when hasOidc is true", () => {
      render(<LoginForm hasOidc={true} />);
      expect(
        screen.getByRole("button", { name: /Sign in with Authentik/i }),
      ).toBeInTheDocument();
    });
  });

  describe("query-param error messages", () => {
    it("surfaces CredentialsSignin as the 'Invalid email or password' banner", () => {
      searchParamsRef.current = new URLSearchParams("error=CredentialsSignin");
      render(<LoginForm hasOidc={false} />);
      expect(
        screen.getByText(/Invalid email or password/i),
      ).toBeInTheDocument();
    });

    it("surfaces OAuthSignin as an Authentik-specific message", () => {
      searchParamsRef.current = new URLSearchParams("error=OAuthSignin");
      render(<LoginForm hasOidc={true} />);
      expect(
        screen.getByText(/Could not connect to Authentik/i),
      ).toBeInTheDocument();
    });

    it("falls back to the Default message for unknown error codes", () => {
      searchParamsRef.current = new URLSearchParams("error=MysteryError");
      render(<LoginForm hasOidc={false} />);
      expect(
        screen.getByText(/error occurred during sign-in/i),
      ).toBeInTheDocument();
    });
  });

  describe("local credential submission", () => {
    it("shows the local error banner when signIn rejects the credentials", async () => {
      vi.mocked(signIn).mockResolvedValueOnce({
        error: "CredentialsSignin",
        ok: false,
        status: 401,
        url: null,
      });

      render(<LoginForm hasOidc={false} />);
      fireEvent.change(screen.getByLabelText("Email"), {
        target: { value: "wrong@example.com" },
      });
      fireEvent.change(screen.getByLabelText("Password"), {
        target: { value: "bad-password" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

      // signIn fires with the credentials
      await waitFor(() => {
        expect(signIn).toHaveBeenCalledWith(
          "local-admin",
          expect.objectContaining({
            email: "wrong@example.com",
            password: "bad-password",
            redirect: false,
          }),
        );
      });

      // Error banner appears — form stays mounted, no redirect
      await waitFor(() => {
        expect(
          screen.getByText(/Invalid email or password/i),
        ).toBeInTheDocument();
      });

      // Submit re-enables after failure
      expect(
        screen.getByRole("button", { name: "Sign in" }),
      ).not.toBeDisabled();
    });

    it("passes the callbackUrl query param through to signIn", async () => {
      searchParamsRef.current = new URLSearchParams("callbackUrl=/retirement");
      vi.mocked(signIn).mockResolvedValueOnce({
        error: "CredentialsSignin",
        ok: false,
        status: 401,
        url: null,
      });

      render(<LoginForm hasOidc={false} />);
      fireEvent.change(screen.getByLabelText("Email"), {
        target: { value: "user@example.com" },
      });
      fireEvent.change(screen.getByLabelText("Password"), {
        target: { value: "pw" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

      await waitFor(() => {
        expect(signIn).toHaveBeenCalledWith(
          "local-admin",
          expect.objectContaining({ callbackUrl: "/retirement" }),
        );
      });
    });
  });
});
