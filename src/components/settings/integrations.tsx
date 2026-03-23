"use client";

import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { useUser, isAdmin } from "@/lib/context/user-context";
import type { Service, PreviewData } from "./integrations-types";
import { PreviewPanel } from "./integrations-preview-panel";

function ServiceCard({
  service,
  label,
  isActive,
  isConnected,
  lastSyncedAt: _lastSyncedAt,
}: {
  service: Service;
  label: string;
  isActive: boolean;
  isConnected: boolean;
  lastSyncedAt: Date | null;
}) {
  const utils = trpc.useUtils();

  // Form state
  const [showUpdateKey, setShowUpdateKey] = useState(false);
  const [ynabToken, setYnabToken] = useState("");
  const [ynabBudgetId, setYnabBudgetId] = useState("");
  const [ynabBudgets, setYnabBudgets] = useState<
    Array<{ id: string; name: string; lastModified: string }>
  >([]);
  const [actualUrl, setActualUrl] = useState("");
  const [actualApiKey, setActualApiKey] = useState("");
  const [actualBudgetSyncId, setActualBudgetSyncId] = useState("");

  const invalidateAll = () => {
    utils.sync.getConnection.invalidate();
    utils.sync.getSyncStatus.invalidate();
    utils.sync.getActiveBudgetApi.invalidate();
    utils.sync.getPreview.invalidate();
  };

  const saveConnectionMut = trpc.sync.saveConnection.useMutation({
    onSuccess: () => {
      invalidateAll();
      setShowUpdateKey(false);
    },
  });
  const testConnectionMut = trpc.sync.testConnection.useMutation();
  const fetchBudgetsMut = trpc.sync.fetchYnabBudgets.useMutation({
    onSuccess: (data) => {
      if (data.success && data.budgets) {
        setYnabBudgets(data.budgets);
        // Auto-select if only one budget
        const first = data.budgets[0];
        if (data.budgets.length === 1 && first) {
          setYnabBudgetId(first.id);
        }
      }
    },
  });
  const deleteConnectionMut = trpc.sync.deleteConnection.useMutation({
    onSuccess: invalidateAll,
  });
  const syncAllMut = trpc.sync.syncAll.useMutation({
    onSuccess: () => {
      invalidateAll();
      utils.sync.getPreview.invalidate({ service });
    },
  });
  const setActiveMut = trpc.sync.setActiveBudgetApi.useMutation({
    onSuccess: invalidateAll,
  });

  // Preview query — only runs when connected
  const { data: preview } = trpc.sync.getPreview.useQuery(
    { service },
    { enabled: isConnected },
  );

  const handleSave = () => {
    if (service === "ynab") {
      if (!ynabToken || !ynabBudgetId) return;
      saveConnectionMut.mutate({
        service: "ynab",
        accessToken: ynabToken,
        budgetId: ynabBudgetId,
      });
    } else {
      if (!actualUrl || !actualApiKey || !actualBudgetSyncId) return;
      saveConnectionMut.mutate({
        service: "actual",
        serverUrl: actualUrl,
        apiKey: actualApiKey,
        budgetSyncId: actualBudgetSyncId,
      });
    }
  };

  const handleDelete = () => {
    if (!confirm(`Remove ${label} connection? This will clear cached data.`))
      return;
    deleteConnectionMut.mutate({ service });
  };

  return (
    <Card title={label}>
      <div className="space-y-4">
        {/* Status line */}
        {isConnected && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
            <span className="text-sm text-secondary">Connected</span>
            {isActive && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-50 text-green-700">
                Active
              </span>
            )}
          </div>
        )}

        {/* Credential form (when not connected, or updating key) */}
        {(!isConnected || showUpdateKey) && (
          <div className="space-y-3">
            {service === "ynab" ? (
              <>
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">
                    Personal Access Token
                  </label>
                  <input
                    type="password"
                    value={ynabToken}
                    onChange={(e) => setYnabToken(e.target.value)}
                    placeholder="Enter YNAB token"
                    className="w-full px-3 py-1.5 text-sm border border-strong rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">
                    Budget
                  </label>
                  <div className="flex gap-2">
                    {ynabBudgets.length > 0 ? (
                      <select
                        value={ynabBudgetId}
                        onChange={(e) => setYnabBudgetId(e.target.value)}
                        className="flex-1 px-3 py-1.5 text-sm border border-strong rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                      >
                        <option value="">Select a budget...</option>
                        {ynabBudgets.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={ynabBudgetId}
                        onChange={(e) => setYnabBudgetId(e.target.value)}
                        placeholder='Click "Fetch" or enter UUID'
                        className="flex-1 px-3 py-1.5 text-sm border border-strong rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        fetchBudgetsMut.mutate({ accessToken: ynabToken })
                      }
                      disabled={!ynabToken || fetchBudgetsMut.isPending}
                      className="px-3 py-1.5 text-sm border border-strong rounded hover:bg-surface-sunken disabled:opacity-50 whitespace-nowrap"
                    >
                      {fetchBudgetsMut.isPending ? "Loading..." : "Fetch"}
                    </button>
                  </div>
                  {fetchBudgetsMut.isSuccess &&
                    !fetchBudgetsMut.data.success && (
                      <p className="text-xs text-red-600 mt-1">
                        {fetchBudgetsMut.data.error}
                      </p>
                    )}
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">
                    Server URL
                  </label>
                  <input
                    type="text"
                    value={actualUrl}
                    onChange={(e) => setActualUrl(e.target.value)}
                    placeholder="https://actual.example.com"
                    className="w-full px-3 py-1.5 text-sm border border-strong rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">
                    API Key
                  </label>
                  <input
                    type="password"
                    value={actualApiKey}
                    onChange={(e) => setActualApiKey(e.target.value)}
                    placeholder="Enter API key"
                    className="w-full px-3 py-1.5 text-sm border border-strong rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">
                    Budget Sync ID
                  </label>
                  <input
                    type="text"
                    value={actualBudgetSyncId}
                    onChange={(e) => setActualBudgetSyncId(e.target.value)}
                    placeholder="Budget sync UUID"
                    className="w-full px-3 py-1.5 text-sm border border-strong rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </>
            )}
            <div className="flex items-center gap-2">
              <button
                onClick={handleSave}
                disabled={saveConnectionMut.isPending}
                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {saveConnectionMut.isPending
                  ? "Saving..."
                  : showUpdateKey
                    ? "Update Credentials"
                    : "Save Connection"}
              </button>
              {showUpdateKey && (
                <button
                  onClick={() => setShowUpdateKey(false)}
                  className="px-3 py-1.5 text-sm text-muted hover:text-primary"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        )}

        {/* Actions (when connected) */}
        {isConnected && (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => testConnectionMut.mutate({ service })}
              disabled={testConnectionMut.isPending}
              className="px-3 py-1.5 text-sm border border-strong rounded hover:bg-surface-sunken disabled:opacity-50"
            >
              {testConnectionMut.isPending ? "Testing..." : "Test"}
            </button>
            <button
              onClick={() => syncAllMut.mutate({ service })}
              disabled={syncAllMut.isPending}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              title="Pull accounts, categories, and transactions from the API into Ledgr (read-only — does not write to the API)"
            >
              {syncAllMut.isPending ? "Syncing..." : "Sync Now"}
            </button>
            {!isActive && preview?.synced && (
              <button
                onClick={() => setActiveMut.mutate({ value: service })}
                disabled={setActiveMut.isPending}
                className="px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
              >
                {setActiveMut.isPending ? "Activating..." : "Activate"}
              </button>
            )}
            {isActive && (
              <button
                onClick={() => setActiveMut.mutate({ value: "none" })}
                disabled={setActiveMut.isPending}
                className="px-3 py-1.5 text-sm border border-red-300 text-red-600 rounded hover:bg-red-50 disabled:opacity-50"
              >
                Deactivate
              </button>
            )}
            <button
              onClick={() => setShowUpdateKey(!showUpdateKey)}
              className="px-3 py-1.5 text-sm text-muted hover:text-primary underline"
            >
              {showUpdateKey ? "Hide" : "Update Key"}
            </button>
            <button
              onClick={handleDelete}
              disabled={deleteConnectionMut.isPending}
              className="px-3 py-1.5 text-sm text-red-600 hover:text-red-800 underline"
            >
              Remove
            </button>
          </div>
        )}

        {/* Test result */}
        {testConnectionMut.isSuccess && testConnectionMut.data && (
          <p
            className={`text-xs ${testConnectionMut.data.success ? "text-green-600" : "text-red-600"}`}
          >
            {testConnectionMut.data.success
              ? `Connected: ${"budgetName" in testConnectionMut.data ? testConnectionMut.data.budgetName : "OK"}`
              : "error" in testConnectionMut.data
                ? testConnectionMut.data.error
                : "Failed"}
          </p>
        )}

        {/* Sync result */}
        {syncAllMut.isSuccess && syncAllMut.data && (
          <div className="space-y-0.5">
            <p className="text-xs text-green-600">
              Pulled {syncAllMut.data.counts.accounts} accounts,{" "}
              {syncAllMut.data.counts.categories} categories,{" "}
              {syncAllMut.data.counts.transactions} transactions from{" "}
              {service.toUpperCase()}
            </p>
            <p className="text-[10px] text-faint">
              Data cached locally. To push changes back, use the Budget or
              Savings page.
            </p>
          </div>
        )}
        {syncAllMut.isError && (
          <p className="text-xs text-red-600">{syncAllMut.error.message}</p>
        )}

        {/* Preview panel — shows after sync, before or after activation */}
        {isConnected && preview?.synced && (
          <PreviewPanel
            preview={preview as PreviewData}
            isActive={isActive}
            service={service}
          />
        )}
      </div>
    </Card>
  );
}

export function IntegrationsSettings() {
  const user = useUser();
  const admin = isAdmin(user);
  const { data: connection } = trpc.sync.getConnection.useQuery();

  if (!admin) {
    return (
      <div className="text-sm text-muted">
        Budget API integrations can only be configured by an admin.
      </div>
    );
  }

  const activeApi = connection?.activeApi ?? "none";

  return (
    <div className="space-y-6">
      {/* Explanation */}
      <div className="text-sm text-muted space-y-2">
        <p>
          Connect a budget API to sync cash balances, categories, and
          transactions. The app works fully without any integration.
        </p>
        <p>
          <strong>Setup:</strong> Save credentials &rarr; Test &rarr; Sync
          &rarr; Review mappings &rarr; Activate when ready.
        </p>
        <details className="bg-surface-sunken rounded-lg text-xs text-muted">
          <summary className="px-3 py-2 cursor-pointer font-medium text-muted hover:text-primary select-none">
            How syncing works
          </summary>
          <div className="px-3 pb-3 space-y-1.5">
            <p>
              <strong className="text-blue-600">Sync Now</strong> (this page)
              pulls data <em>from</em> the API into Ledgr&apos;s local cache
              &mdash; accounts, categories, balances, and transactions. It never
              writes to the API. Use it to refresh your cached data.
            </p>
            <p>
              <strong className="text-green-600">Pushing to the API</strong>{" "}
              happens on individual pages when you&apos;re ready:
            </p>
            <ul className="list-disc pl-4 space-y-0.5">
              <li>
                <strong>Budget page</strong> &mdash; &ldquo;Push to YNAB&rdquo;
                sends budgeted amounts for items with push/both direction.
              </li>
              <li>
                <strong>Savings page</strong> &mdash; &ldquo;Push
                Contributions&rdquo; sends monthly contribution amounts and goal
                targets for linked funds.
              </li>
              <li>
                <strong>Savings auto-push</strong> &mdash; editing a linked
                fund&apos;s monthly contribution saves locally first, then shows
                a preview before pushing.
              </li>
            </ul>
            <p>
              All pushes show a <strong>confirmation preview</strong> with the
              current API value, the new Ledgr value, and the difference &mdash;
              nothing is written to the API until you confirm.
            </p>
            <p>
              Per-item <strong>sync direction</strong> controls which way data
              flows: <span className="text-blue-500">pull</span> = API&rarr;Ledgr,{" "}
              <span className="text-green-500">push</span> = Ledgr&rarr;API,{" "}
              <span className="text-purple-500">both</span> = two-way.
            </p>
          </div>
        </details>
      </div>

      {/* Current status */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted">Active API:</span>
        {activeApi === "none" ? (
          <span className="text-faint">None (manual mode)</span>
        ) : (
          <span className="font-medium text-blue-600">
            {activeApi.toUpperCase()}
          </span>
        )}
      </div>

      <ServiceCard
        service="ynab"
        label="YNAB"
        isActive={activeApi === "ynab"}
        isConnected={connection?.ynab.connected ?? false}
        lastSyncedAt={
          connection?.ynab.lastSyncedAt
            ? new Date(connection.ynab.lastSyncedAt)
            : null
        }
      />

      <ServiceCard
        service="actual"
        label="Actual Budget"
        isActive={activeApi === "actual"}
        isConnected={connection?.actual.connected ?? false}
        lastSyncedAt={
          connection?.actual.lastSyncedAt
            ? new Date(connection.actual.lastSyncedAt)
            : null
        }
      />

      {/* Account mappings are now managed in the preview panel after syncing */}
    </div>
  );
}
