"use client";

/** Settings tab for Authentik OIDC authentication — displays required environment variables and provides a connection test button. */
import { useState } from "react";
import { trpc } from "@/lib/trpc";

export function AuthSettings() {
  const [shouldTest, setShouldTest] = useState(false);

  const testConnection = trpc.settings.testOidcConnection.useQuery(undefined, {
    enabled: shouldTest,
  });

  const testResult = testConnection.data ?? null;
  const testing = testConnection.isFetching;

  const handleTest = () => {
    if (shouldTest) {
      testConnection.refetch();
    } else {
      setShouldTest(true);
    }
  };

  return (
    <div className="space-y-8">
      {/* OIDC Status */}
      <section>
        <h3 className="text-lg font-semibold text-primary mb-1">
          Authentik (OIDC)
        </h3>
        <p className="text-sm text-muted mb-4">
          Single sign-on via Authentik allows household members to log in with
          their Authentik credentials. Permissions are mapped from Authentik
          groups &mdash; once this connection is set up, head to{" "}
          <strong>RBAC Groups</strong> to map group names to permissions.
        </p>

        {/* Moved here from the RBAC Groups section — this is the one place
         *  the Authentik OIDC provider setup walkthrough lives now (was
         *  duplicated across both sections before the Access Control
         *  consolidation made the overlap visible). */}
        <div className="border bg-surface-sunken rounded-lg p-4 mb-4">
          <h4 className="text-sm font-semibold text-primary mb-2">
            Authentik OIDC Provider Setup
          </h4>
          <ol className="text-xs text-secondary space-y-1.5 list-decimal list-inside">
            <li>
              In Authentik, go to <strong>Applications &rarr; Providers</strong>{" "}
              and create a new <strong>OAuth2/OpenID Provider</strong>.
            </li>
            <li>
              Set the <strong>Redirect URI</strong> to{" "}
              <code className="bg-surface-strong px-1 rounded">
                https://&lt;your-app-domain&gt;/api/auth/callback/authentik
              </code>
              .
            </li>
            <li>
              Under <strong>Advanced protocol settings</strong>, add{" "}
              <code className="bg-surface-strong px-1 rounded">groups</code> to
              the <strong>Scopes</strong> list so group membership is included
              in the OIDC token.
            </li>
            <li>
              Create an <strong>Application</strong> linked to this provider.
            </li>
            <li>
              Copy the <strong>Client ID</strong>,{" "}
              <strong>Client Secret</strong>, and{" "}
              <strong>OpenID Configuration Issuer</strong> URL.
            </li>
            <li>
              Set three environment variables on the app server:
              <div className="mt-1 ml-4 space-y-0.5 font-mono">
                <div>
                  <code className="bg-surface-strong px-1 rounded">
                    AUTH_AUTHENTIK_ISSUER
                  </code>{" "}
                  &mdash; Issuer URL (e.g.{" "}
                  <code className="bg-surface-strong px-1 rounded">
                    https://auth.example.com/application/o/ledgr/
                  </code>
                  )
                </div>
                <div>
                  <code className="bg-surface-strong px-1 rounded">
                    AUTH_AUTHENTIK_ID
                  </code>{" "}
                  &mdash; Client ID from the provider
                </div>
                <div>
                  <code className="bg-surface-strong px-1 rounded">
                    AUTH_AUTHENTIK_SECRET
                  </code>{" "}
                  &mdash; Client Secret from the provider
                </div>
              </div>
            </li>
            <li>
              Restart the app. The login page will now redirect to Authentik
              instead of using dev auto-login.
            </li>
          </ol>
          <p className="text-xs text-muted mt-2 italic">
            Without these env vars, the app runs in dev mode with automatic
            admin login.
          </p>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={handleTest}
            disabled={testing}
            className="px-4 py-2 rounded-lg border border-default text-primary text-sm font-medium hover:bg-surface-elevated transition-colors disabled:opacity-50"
          >
            {testing ? "Testing..." : "Test Connection"}
          </button>

          {testResult && (
            <span
              className={`text-sm ${
                testResult.configured && testResult.reachable
                  ? "text-green-600 dark:text-green-400"
                  : "text-amber-600 dark:text-amber-400"
              }`}
            >
              {testResult.configured && testResult.reachable
                ? `Connected (${testResult.issuer})`
                : testResult.configured
                  ? "Configured but unreachable"
                  : "Not configured"}
            </span>
          )}
        </div>
      </section>

      {/* Local Admin Info */}
      <section>
        <h3 className="text-lg font-semibold text-primary mb-1">Local Admin</h3>
        <p className="text-sm text-muted">
          A local admin account was created during onboarding. This account
          serves as a fallback login method when Authentik is unavailable.
        </p>
      </section>
    </div>
  );
}
