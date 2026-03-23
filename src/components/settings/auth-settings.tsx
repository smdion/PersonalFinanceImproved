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

  const envVars = [
    {
      name: "AUTH_AUTHENTIK_ISSUER",
      description: "Authentik application OAuth2 issuer URL",
    },
    {
      name: "AUTH_AUTHENTIK_ID",
      description: "OAuth2 Client ID from the Authentik provider",
    },
    {
      name: "AUTH_AUTHENTIK_SECRET",
      description: "OAuth2 Client Secret from the Authentik provider",
    },
  ];

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
          groups.
        </p>

        <div className="bg-surface-secondary rounded-lg p-4 text-sm mb-4">
          <p className="text-secondary mb-3">
            Set these environment variables in your Docker Compose or container
            configuration:
          </p>
          <div className="space-y-2">
            {envVars.map((v) => (
              <div key={v.name} className="flex items-start gap-2">
                <code className="text-blue-600 dark:text-blue-400 font-mono text-xs shrink-0">
                  {v.name}
                </code>
                <span className="text-muted text-xs">{v.description}</span>
              </div>
            ))}
          </div>
          <p className="text-muted text-xs mt-3">
            Restart the container after changing environment variables.
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
