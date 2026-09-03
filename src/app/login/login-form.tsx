"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { BRAND_COLORS } from "@/lib/utils/colors";

const ERROR_MESSAGES: Record<string, string> = {
  CredentialsSignin: "Invalid email or password.",
  OAuthSignin: "Could not connect to Authentik. Check your OIDC configuration.",
  OAuthCallback: "Authentication callback failed. Try again.",
  Default: "An error occurred during sign-in. Please try again.",
};

function LedgrLogo() {
  return (
    <svg
      aria-hidden="true"
      width="48"
      height="48"
      viewBox="0 0 32 32"
      className="shrink-0"
    >
      <rect
        width="32"
        height="32"
        rx="6"
        className="fill-slate-700 dark:fill-slate-600"
      />
      <path
        d="M10 6 L10 24 L22 24"
        stroke={BRAND_COLORS.logoAccent}
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <line
        x1="14"
        y1="14"
        x2="20"
        y2="14"
        stroke={BRAND_COLORS.logoAccent}
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.5"
      />
      <line
        x1="14"
        y1="18"
        x2="18"
        y2="18"
        stroke={BRAND_COLORS.logoAccent}
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.5"
      />
    </svg>
  );
}

export function LoginForm({ hasOidc }: { hasOidc: boolean }) {
  const searchParams = useSearchParams();
  const errorCode = searchParams.get("error");
  const callbackUrl = searchParams.get("callbackUrl") ?? "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const errorMessage = errorCode
    ? (ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES.Default)
    : null;

  async function handleLocalLogin(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);
    setLocalError(null);

    const result = await signIn("local-admin", {
      email,
      password,
      redirect: false,
      callbackUrl,
    });

    if (result?.error) {
      setLocalError("Invalid email or password.");
      setIsLoading(false);
    } else if (result?.url) {
      window.location.href = result.url;
    }
  }

  function handleOidcLogin() {
    signIn("authentik", { callbackUrl });
  }

  return (
    <div className="bg-surface-primary flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo and title */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <LedgrLogo />
          <div className="text-center">
            <h1 className="text-primary text-2xl font-bold">Ledgr</h1>
            <p className="text-muted text-sm">Personal Finance Dashboard</p>
          </div>
        </div>

        {/* Card */}
        <div className="bg-surface-elevated border-default rounded-2xl border p-6 shadow-xl">
          {/* Error display */}
          {(errorMessage || localError) && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
              {localError ?? errorMessage}
            </div>
          )}

          {/* Authentik OIDC button */}
          {hasOidc && (
            <>
              <button
                onClick={handleOidcLogin}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 font-medium text-white transition-colors hover:bg-blue-700"
              >
                <svg
                  aria-hidden="true"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                  <polyline points="10 17 15 12 10 7" />
                  <line x1="15" y1="12" x2="3" y2="12" />
                </svg>
                Sign in with Authentik
              </button>

              {/* Divider */}
              <div className="my-5 flex items-center gap-3">
                <div className="bg-surface-strong h-px flex-1" />
                <span className="text-muted text-sm">or</span>
                <div className="bg-surface-strong h-px flex-1" />
              </div>
            </>
          )}

          {/* Local admin login form */}
          <form onSubmit={handleLocalLogin} className="flex flex-col gap-4">
            <div>
              <label
                htmlFor="email"
                className="text-secondary mb-1 block text-sm font-medium"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="border-default bg-input text-input-text placeholder:text-input-placeholder w-full rounded-lg border px-3 py-2 focus:ring-2 focus:ring-[rgb(var(--c-focus-ring))] focus:outline-none"
                placeholder="admin@example.com"
              />
            </div>
            <div>
              <label
                htmlFor="password"
                className="text-secondary mb-1 block text-sm font-medium"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="border-default bg-input text-input-text placeholder:text-input-placeholder w-full rounded-lg border px-3 py-2 focus:ring-2 focus:ring-[rgb(var(--c-focus-ring))] focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={isLoading}
              className="border-default text-primary hover:bg-surface-secondary w-full rounded-lg border px-4 py-2.5 font-medium transition-colors disabled:opacity-50"
            >
              {isLoading ? "Signing in..." : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
