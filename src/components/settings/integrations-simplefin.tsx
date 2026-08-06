"use client";

/** Settings card for the SimpleFIN Bridge connection (Phase 1: daily linked-balance pulse only — no budget/category sync, so this doesn't reuse ServiceCard's YNAB/Actual-specific fields). */
import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils/format";

type SimplefinAccountListItem = {
  id: number;
  orgName: string;
  accountName: string;
  lastBalance: number;
  isIncluded: boolean;
  linkedPerformanceAccountId: number | null;
  snapshotBalance: number | null;
  change: number | null;
};

type MatchableAccount = { id: number; label: string };

/** Group accounts by institution, preserving the orgName/accountName order the query already returns. */
function groupAccountsByOrg(
  accounts: SimplefinAccountListItem[],
): Array<[string, SimplefinAccountListItem[]]> {
  const groups = new Map<string, SimplefinAccountListItem[]>();
  for (const account of accounts) {
    const existing = groups.get(account.orgName);
    if (existing) existing.push(account);
    else groups.set(account.orgName, [account]);
  }
  return Array.from(groups.entries());
}

function AccountRow({
  account,
  matchableAccounts,
  onToggleIncluded,
  onMatch,
}: {
  account: SimplefinAccountListItem;
  matchableAccounts: MatchableAccount[];
  onToggleIncluded: (isIncluded: boolean) => void;
  onMatch: (performanceAccountId: number | null) => void;
}) {
  const change = account.change;
  return (
    <div className="text-sm">
      <label className="flex items-center justify-between gap-2 cursor-pointer">
        <span className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={account.isIncluded}
            onChange={(e) => onToggleIncluded(e.target.checked)}
            className="w-4 h-4 accent-blue-600"
          />
          <span
            className={
              account.isIncluded ? "text-primary" : "text-faint line-through"
            }
          >
            {account.accountName}
          </span>
        </span>
        <span className="text-muted">
          {formatCurrency(account.lastBalance)}
        </span>
      </label>
      <div className="flex items-center justify-between gap-2 mt-1 pl-6">
        <select
          value={account.linkedPerformanceAccountId ?? ""}
          onChange={(e) =>
            onMatch(e.target.value ? Number(e.target.value) : null)
          }
          className="text-caption border border-strong rounded px-1.5 py-0.5 bg-surface-primary text-muted"
        >
          <option value="">Not linked to a tracked account</option>
          {matchableAccounts.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        {change !== null && (
          <span
            className={`text-caption ${change === 0 ? "text-faint" : change > 0 ? "text-green-600" : "text-red-600"}`}
          >
            {change === 0
              ? "matches last snapshot"
              : `${change > 0 ? "↑" : "↓"} ${formatCurrency(Math.abs(change))} vs. last snapshot`}
          </span>
        )}
      </div>
    </div>
  );
}

export function SimplefinCard() {
  const utils = trpc.useUtils();
  const [setupToken, setSetupToken] = useState("");
  const [showUpdateToken, setShowUpdateToken] = useState(false);

  const { data: status } = trpc.simplefin.getStatus.useQuery();
  const isConnected = status?.connected ?? false;
  const { data: accounts } = trpc.simplefin.listAccounts.useQuery(undefined, {
    enabled: isConnected,
  });
  const { data: matchableAccounts } =
    trpc.simplefin.listMatchableAccounts.useQuery(undefined, {
      enabled: isConnected,
    });

  const invalidate = () => {
    utils.simplefin.getStatus.invalidate();
    utils.simplefin.listBalanceHistory.invalidate();
    utils.simplefin.listAccounts.invalidate();
  };

  const setAccountIncludedMut = trpc.simplefin.setAccountIncluded.useMutation({
    onSuccess: invalidate,
  });
  const setAccountMappingMut = trpc.simplefin.setAccountMapping.useMutation({
    onSuccess: invalidate,
  });

  const saveTokenMut = trpc.simplefin.saveToken.useMutation({
    onSuccess: () => {
      invalidate();
      setSetupToken("");
      setShowUpdateToken(false);
    },
  });
  const testConnectionMut = trpc.simplefin.testConnection.useMutation();
  const syncNowMut = trpc.simplefin.syncNow.useMutation({
    onSuccess: invalidate,
  });
  const removeConnectionMut = trpc.simplefin.removeConnection.useMutation({
    onSuccess: invalidate,
  });

  const handleConnect = () => {
    if (!setupToken) return;
    saveTokenMut.mutate({ setupToken });
  };

  const handleRemove = () => {
    if (
      !confirm(
        "Remove SimpleFIN connection? Historical daily balances are kept.",
      )
    )
      return;
    removeConnectionMut.mutate();
  };

  return (
    <Card title="SimpleFIN Bridge">
      <div className="space-y-4">
        <p className="text-xs text-muted">
          Links to{" "}
          <a
            href="https://beta-bridge.simplefin.org/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-primary"
          >
            SimpleFIN Bridge
          </a>{" "}
          for a daily linked-account balance total on the dashboard. Read-only —
          never writes to your banks. Doesn&apos;t replace the weekly portfolio
          snapshot (sub-account tax classification still needs to be entered
          manually).
        </p>

        {isConnected && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
            <span className="text-sm text-secondary">Connected</span>
            {status?.lastSyncedAt && (
              <span className="text-caption text-faint">
                Last synced {new Date(status.lastSyncedAt).toLocaleString()}
              </span>
            )}
          </div>
        )}

        {(!isConnected || showUpdateToken) && (
          <div className="space-y-3">
            <div>
              <label
                htmlFor="simplefin-setup-token"
                className="block text-xs font-medium text-muted mb-1"
              >
                Setup Token
              </label>
              <input
                id="simplefin-setup-token"
                type="password"
                value={setupToken}
                onChange={(e) => setSetupToken(e.target.value)}
                placeholder="One-time setup token from SimpleFIN Bridge"
                className="w-full px-3 py-1.5 text-sm border border-strong rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleConnect}
                disabled={!setupToken || saveTokenMut.isPending}
                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {saveTokenMut.isPending ? "Connecting..." : "Connect"}
              </button>
              {showUpdateToken && (
                <button
                  onClick={() => setShowUpdateToken(false)}
                  className="px-3 py-1.5 text-sm text-muted hover:text-primary"
                >
                  Cancel
                </button>
              )}
            </div>
            {saveTokenMut.isError && (
              <p className="text-xs text-red-600">
                {saveTokenMut.error.message}
              </p>
            )}
          </div>
        )}

        {isConnected && (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => testConnectionMut.mutate()}
              disabled={testConnectionMut.isPending}
              className="px-3 py-1.5 text-sm border border-strong rounded hover:bg-surface-sunken disabled:opacity-50"
            >
              {testConnectionMut.isPending ? "Testing..." : "Test"}
            </button>
            <button
              onClick={() => syncNowMut.mutate()}
              disabled={syncNowMut.isPending}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              title="Pull current balances and update today's snapshot"
            >
              {syncNowMut.isPending ? "Syncing..." : "Sync Now"}
            </button>
            <button
              onClick={() => setShowUpdateToken(!showUpdateToken)}
              className="px-3 py-1.5 text-sm text-muted hover:text-primary underline"
            >
              {showUpdateToken ? "Hide" : "Reconnect"}
            </button>
            <button
              onClick={handleRemove}
              disabled={removeConnectionMut.isPending}
              className="px-3 py-1.5 text-sm text-red-600 hover:text-red-800 underline"
            >
              Remove
            </button>
          </div>
        )}

        {testConnectionMut.isSuccess && testConnectionMut.data && (
          <p
            className={`text-xs ${testConnectionMut.data.success ? "text-green-600" : "text-red-600"}`}
          >
            {testConnectionMut.data.success
              ? `Connected: ${testConnectionMut.data.accountCount} linked account(s)`
              : testConnectionMut.data.error}
          </p>
        )}

        {syncNowMut.isSuccess && syncNowMut.data && (
          <p className="text-xs text-green-600">
            Synced {syncNowMut.data.accountCount} account(s), total{" "}
            {formatCurrency(syncNowMut.data.totalBalance)}
          </p>
        )}
        {syncNowMut.isError && (
          <p className="text-xs text-red-600">{syncNowMut.error.message}</p>
        )}

        {isConnected && accounts && accounts.length > 0 && (
          <div className="space-y-3 border-t border-subtle pt-3">
            <p className="text-caption text-faint">
              Unchecking an account removes it from today&apos;s total
              immediately — it doesn&apos;t change any prior day&apos;s history.
              Matching an account to an existing tracked account shows how its
              live balance compares to your last snapshot — it never writes to
              the snapshot. You can match more than one SimpleFIN account to the
              same tracked account (e.g. a historical split) — the comparison
              uses their combined balance.
            </p>
            {groupAccountsByOrg(accounts).map(([orgName, orgAccounts]) => (
              <div key={orgName}>
                <p className="text-xs font-medium text-muted mb-1">
                  {orgName || "Unknown institution"}
                </p>
                <div className="space-y-2">
                  {orgAccounts.map((account) => (
                    <AccountRow
                      key={account.id}
                      account={account}
                      matchableAccounts={matchableAccounts ?? []}
                      onToggleIncluded={(isIncluded) =>
                        setAccountIncludedMut.mutate({
                          id: account.id,
                          isIncluded,
                        })
                      }
                      onMatch={(performanceAccountId) =>
                        setAccountMappingMut.mutate({
                          id: account.id,
                          performanceAccountId,
                        })
                      }
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
