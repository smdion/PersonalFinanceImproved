/** The first-run wizard's OIDC step. */
import { useState } from "react";
import { trpc } from "@/lib/trpc";

export function OidcStep() {
  const [shouldTest, setShouldTest] = useState(false);

  const testConnection = trpc.settings.getOidcStatus.useQuery(undefined, {
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
      example: "https://auth.example.com/application/o/ledgr",
    },
    {
      name: "AUTH_AUTHENTIK_ID",
      description: "OAuth2 Client ID from the Authentik provider",
      example: "your-client-id",
    },
    {
      name: "AUTH_AUTHENTIK_SECRET",
      description: "OAuth2 Client Secret from the Authentik provider",
      example: "your-client-secret",
    },
  ];

  return (
    <div className="flex flex-col gap-6 py-4">
      <div className="text-center">
        <h2 className="text-primary text-2xl font-bold">
          Connect to Authentik
        </h2>
        <p className="text-muted mt-1">
          Enable SSO for your household. You can set this up later in Settings.
        </p>
      </div>

      <div className="bg-surface-secondary rounded-lg p-4 text-sm">
        <p className="text-secondary mb-3">
          Set these environment variables in your Docker Compose or container
          configuration, then restart the container:
        </p>
        <div className="space-y-3">
          {envVars.map((v) => (
            <div key={v.name}>
              <code className="font-mono text-xs text-blue-600 dark:text-blue-400">
                {v.name}
              </code>
              <p className="text-muted mt-0.5 text-xs">{v.description}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Test connection */}
      <div className="flex flex-col items-center gap-3">
        <button
          onClick={handleTest}
          disabled={testing}
          className="border-default text-primary hover:bg-surface-elevated rounded-lg border px-4 py-2 font-medium transition-colors disabled:opacity-50"
        >
          {testing ? "Testing..." : "Test Connection"}
        </button>

        {testResult && (
          <div
            className={`w-full rounded-lg p-3 text-center text-sm ${
              testResult.configured && testResult.reachable
                ? "border border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400"
                : "border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400"
            }`}
          >
            {testResult.configured && testResult.reachable && (
              <>Authentik is connected ({testResult.issuer})</>
            )}
            {testResult.configured && !testResult.reachable && (
              <>
                Environment variables are set but the issuer is not reachable.
                Check the URL and try again.
              </>
            )}
            {!testResult.configured && (
              <>
                Environment variables are not configured yet. Set them and
                restart the container, then test again.
              </>
            )}
          </div>
        )}
      </div>

      <p className="text-muted text-center text-xs">
        After setting environment variables, restart the container for changes
        to take effect. OIDC can also be configured later from the Settings
        page.
      </p>
    </div>
  );
}
