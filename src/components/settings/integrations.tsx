"use client";

/** Settings tab for managing YNAB and Actual Budget API connections — handles credential entry, connection testing, syncing, activation, and renders the preview panel for each service. */
import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FormField, FormInput, FormSelect } from "@/components/forms";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { SK_SETTINGS_INTEGRATIONS_SECTION } from "@/lib/constants/settings-keys";
import type { Service, PreviewData } from "./integrations-types";
import { PreviewPanel } from "./integrations-preview-panel";
import { SimplefinCard } from "./integrations-simplefin";
import {
  ConnectionStatusLine,
  ConnectionResultMessage,
} from "./integrations/connection-card";
import { SyncBehaviorSettings } from "./integrations/sync-behavior";

/** Credential-form field labels/placeholders per service — the two services'
 *  forms otherwise differ too much (YNAB has a budget-fetch selector, Actual
 *  has three plain fields) to fully unify, but the labels/placeholders
 *  themselves are genuinely parallel data. */
const SERVICE_CREDENTIAL_FIELDS = {
  ynab: {
    token: { label: "Personal Access Token", placeholder: "Enter YNAB token" },
    budget: { label: "Budget" },
  },
  actual: {
    url: { label: "Server URL", placeholder: "https://actual.example.com" },
    apiKey: { label: "API Key", placeholder: "Enter API key" },
    budgetSyncId: { label: "Budget Sync ID", placeholder: "Budget sync UUID" },
  },
} as const;

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
    utils.savings.invalidate();
    utils.budget.invalidate();
    utils.assets.invalidate();
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
          <ConnectionStatusLine
            connected
            extra={isActive && <Badge color="green">Active</Badge>}
          />
        )}

        {/* Credential form (when not connected, or updating key) */}
        {(!isConnected || showUpdateKey) && (
          <div className="space-y-3">
            {service === "ynab" ? (
              <>
                <FormField label={SERVICE_CREDENTIAL_FIELDS.ynab.token.label}>
                  <FormInput
                    type="password"
                    value={ynabToken}
                    onChange={(e) => setYnabToken(e.target.value)}
                    placeholder={
                      SERVICE_CREDENTIAL_FIELDS.ynab.token.placeholder
                    }
                  />
                </FormField>
                <FormField label={SERVICE_CREDENTIAL_FIELDS.ynab.budget.label}>
                  <div className="flex gap-2">
                    {ynabBudgets.length > 0 ? (
                      <FormSelect
                        value={ynabBudgetId}
                        onChange={(e) => setYnabBudgetId(e.target.value)}
                        className="flex-1"
                      >
                        <option value="">Select a budget...</option>
                        {ynabBudgets.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </FormSelect>
                    ) : (
                      <FormInput
                        type="text"
                        value={ynabBudgetId}
                        onChange={(e) => setYnabBudgetId(e.target.value)}
                        placeholder='Click "Fetch" or enter UUID'
                        className="flex-1"
                      />
                    )}
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        fetchBudgetsMut.mutate({ accessToken: ynabToken })
                      }
                      disabled={!ynabToken || fetchBudgetsMut.isPending}
                      className="whitespace-nowrap"
                    >
                      {fetchBudgetsMut.isPending ? "Loading..." : "Fetch"}
                    </Button>
                  </div>
                  {fetchBudgetsMut.isSuccess &&
                    !fetchBudgetsMut.data.success && (
                      <p className="mt-1 text-xs text-red-600">
                        {fetchBudgetsMut.data.error}
                      </p>
                    )}
                </FormField>
              </>
            ) : (
              <>
                <FormField label={SERVICE_CREDENTIAL_FIELDS.actual.url.label}>
                  <FormInput
                    type="text"
                    value={actualUrl}
                    onChange={(e) => setActualUrl(e.target.value)}
                    placeholder={
                      SERVICE_CREDENTIAL_FIELDS.actual.url.placeholder
                    }
                  />
                </FormField>
                <FormField
                  label={SERVICE_CREDENTIAL_FIELDS.actual.apiKey.label}
                >
                  <FormInput
                    type="password"
                    value={actualApiKey}
                    onChange={(e) => setActualApiKey(e.target.value)}
                    placeholder={
                      SERVICE_CREDENTIAL_FIELDS.actual.apiKey.placeholder
                    }
                  />
                </FormField>
                <FormField
                  label={SERVICE_CREDENTIAL_FIELDS.actual.budgetSyncId.label}
                >
                  <FormInput
                    type="text"
                    value={actualBudgetSyncId}
                    onChange={(e) => setActualBudgetSyncId(e.target.value)}
                    placeholder={
                      SERVICE_CREDENTIAL_FIELDS.actual.budgetSyncId.placeholder
                    }
                  />
                </FormField>
              </>
            )}
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={handleSave}
                disabled={saveConnectionMut.isPending}
              >
                {saveConnectionMut.isPending
                  ? "Saving..."
                  : showUpdateKey
                    ? "Update Credentials"
                    : "Save Connection"}
              </Button>
              {showUpdateKey && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowUpdateKey(false)}
                >
                  Cancel
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Actions (when connected) */}
        {isConnected && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => testConnectionMut.mutate({ service })}
              disabled={testConnectionMut.isPending}
            >
              {testConnectionMut.isPending ? "Testing..." : "Test"}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => syncAllMut.mutate({ service })}
              disabled={syncAllMut.isPending}
              title="Pull accounts, categories, and transactions from the API into Ledgr (read-only — does not write to the API)"
            >
              {syncAllMut.isPending ? "Syncing..." : "Sync Now"}
            </Button>
            {!isActive && preview?.synced && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => setActiveMut.mutate({ value: service })}
                disabled={setActiveMut.isPending}
              >
                {setActiveMut.isPending ? "Activating..." : "Activate"}
              </Button>
            )}
            {/* Live-user finding, 2026-08-30: a connected-but-never-synced
                service silently had NO Activate button and no explanation
                why — `getPreview` returns `synced: false` until a sync has
                completed at least once, so the only way to make this
                service active was invisible unless you already knew to
                click "Sync Now" first. This makes the missing precondition
                explicit instead of a silent gap. */}
            {!isActive && preview && !preview.synced && (
              <span className="text-muted text-xs italic">
                Sync Now to enable activation
              </span>
            )}
            {isActive && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setActiveMut.mutate({ value: "none" })}
                disabled={setActiveMut.isPending}
              >
                Deactivate
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowUpdateKey(!showUpdateKey)}
            >
              {showUpdateKey ? "Hide" : "Update Key"}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={handleDelete}
              disabled={deleteConnectionMut.isPending}
            >
              Remove
            </Button>
          </div>
        )}

        {/* Test result */}
        {testConnectionMut.isSuccess && testConnectionMut.data && (
          <ConnectionResultMessage
            tone={testConnectionMut.data.success ? "success" : "error"}
          >
            {testConnectionMut.data.success
              ? `Connected: ${"budgetName" in testConnectionMut.data ? testConnectionMut.data.budgetName : "OK"}`
              : "error" in testConnectionMut.data
                ? testConnectionMut.data.error
                : "Failed"}
          </ConnectionResultMessage>
        )}

        {/* Sync result */}
        {syncAllMut.isSuccess && syncAllMut.data && (
          <div className="space-y-0.5">
            <ConnectionResultMessage tone="success">
              Pulled {syncAllMut.data.counts.accounts} accounts,{" "}
              {syncAllMut.data.counts.categories} categories,{" "}
              {syncAllMut.data.counts.transactions} transactions from{" "}
              {service.toUpperCase()}
            </ConnectionResultMessage>
            <p className="text-caption text-faint">
              Data cached locally. To push changes back, use the Budget or
              Savings page.
            </p>
          </div>
        )}
        {syncAllMut.isError && (
          <ConnectionResultMessage tone="error">
            {syncAllMut.error.message}
          </ConnectionResultMessage>
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

const INTEGRATIONS_SECTIONS = [
  { key: "ynab", label: "YNAB" },
  { key: "actual", label: "Actual Budget" },
  { key: "simplefin", label: "SimpleFIN" },
  { key: "syncBehavior", label: "Sync Behavior" },
] as const;

type IntegrationsSectionKey = (typeof INTEGRATIONS_SECTIONS)[number]["key"];

function NavStatusDot({ connected }: { connected: boolean }) {
  return (
    <span
      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${connected ? "bg-green-500" : "bg-surface-strong"}`}
    />
  );
}

export function IntegrationsSettings() {
  const user = useUser();
  const admin = isAdmin(user);
  const { data: connection } = trpc.sync.getConnection.useQuery();
  const { data: simplefinStatus } = trpc.simplefin.getStatus.useQuery();
  const [section, setSection] = usePersistedSetting<IntegrationsSectionKey>(
    SK_SETTINGS_INTEGRATIONS_SECTION,
    "ynab",
  );

  if (!admin) {
    return (
      <div className="text-muted text-sm">
        Budget API integrations can only be configured by an admin.
      </div>
    );
  }

  const activeApi = connection?.activeApi ?? "none";

  return (
    <div className="space-y-6">
      {/* Explanation */}
      <div className="text-muted space-y-2 text-sm">
        <p>
          Connect a budget API to sync cash balances, categories, and
          transactions. The app works fully without any integration.
        </p>
        <p>
          <strong>Setup:</strong> Save credentials &rarr; Test &rarr; Sync
          &rarr; Review mappings &rarr; Activate when ready.
        </p>
        <details className="bg-surface-sunken text-muted rounded-lg text-xs">
          <summary className="text-muted hover:text-primary cursor-pointer px-3 py-2 font-medium select-none">
            How syncing works
          </summary>
          <div className="space-y-1.5 px-3 pb-3">
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
            <ul className="list-disc space-y-0.5 pl-4">
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
              flows: <span className="text-blue-500">pull</span> =
              API&rarr;Ledgr, <span className="text-green-500">push</span> =
              Ledgr&rarr;API, <span className="text-purple-500">both</span> =
              two-way.
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

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[200px_1fr]">
        <nav className="flex gap-1 overflow-x-auto md:flex-col">
          {INTEGRATIONS_SECTIONS.map((s) => (
            <button
              key={s.key}
              onClick={() => setSection(s.key)}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm whitespace-nowrap transition-colors ${
                section === s.key
                  ? "bg-blue-600 text-white"
                  : "text-secondary hover:bg-surface-elevated"
              }`}
            >
              {s.key === "ynab" && (
                <NavStatusDot connected={connection?.ynab.connected ?? false} />
              )}
              {s.key === "actual" && (
                <NavStatusDot
                  connected={connection?.actual.connected ?? false}
                />
              )}
              {s.key === "simplefin" && (
                <NavStatusDot connected={simplefinStatus?.connected ?? false} />
              )}
              {s.label}
            </button>
          ))}
        </nav>

        <div>
          {/* YNAB/Actual/SimpleFin stay mounted at all times — each holds
              in-progress local state (credential drafts, fetched budget
              list, test/sync results) that would silently reset if the nav
              unmounted them on every switch away and back. Only visibility
              toggles. */}
          <div className={section === "ynab" ? "" : "hidden"}>
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
          </div>
          <div className={section === "actual" ? "" : "hidden"}>
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
          </div>
          <div className={section === "simplefin" ? "" : "hidden"}>
            <SimplefinCard />
          </div>
          {section === "syncBehavior" && <SyncBehaviorSettings />}
        </div>
      </div>
    </div>
  );
}
