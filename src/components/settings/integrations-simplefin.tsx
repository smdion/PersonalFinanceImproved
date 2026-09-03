"use client";

/** Settings card for the SimpleFIN Bridge connection (Phase 1: daily linked-balance pulse only — no budget/category sync, so this doesn't reuse ServiceCard's YNAB/Actual-specific fields). */
import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils/format";
import {
  ConnectionStatusLine,
  ConnectionResultMessage,
} from "./integrations/connection-card";

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
      <label className="flex cursor-pointer items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={account.isIncluded}
            onChange={(e) => onToggleIncluded(e.target.checked)}
            className="h-4 w-4 accent-blue-600"
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
      <div className="mt-1 flex items-center justify-between gap-2 pl-6">
        <select
          value={account.linkedPerformanceAccountId ?? ""}
          onChange={(e) =>
            onMatch(e.target.value ? Number(e.target.value) : null)
          }
          className="text-caption border-strong bg-surface-primary text-muted rounded border px-1.5 py-0.5"
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
        <p className="text-muted text-xs">
          Links to{" "}
          <a
            href="https://beta-bridge.simplefin.org/"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-primary underline"
          >
            SimpleFIN Bridge
          </a>{" "}
          for a daily linked-account balance total on the dashboard. Read-only —
          never writes to your banks. Doesn&apos;t replace the weekly portfolio
          snapshot (sub-account tax classification still needs to be entered
          manually).
        </p>

        {isConnected && (
          <ConnectionStatusLine
            connected
            extra={
              status?.lastSyncedAt && (
                <span className="text-caption text-faint">
                  Last synced {new Date(status.lastSyncedAt).toLocaleString()}
                </span>
              )
            }
          />
        )}

        {(!isConnected || showUpdateToken) && (
          <div className="space-y-3">
            <div>
              <label
                htmlFor="simplefin-setup-token"
                className="text-muted mb-1 block text-xs font-medium"
              >
                Setup Token
              </label>
              <input
                id="simplefin-setup-token"
                type="password"
                value={setupToken}
                onChange={(e) => setSetupToken(e.target.value)}
                placeholder="One-time setup token from SimpleFIN Bridge"
                className="border-strong w-full rounded border px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={handleConnect}
                disabled={!setupToken || saveTokenMut.isPending}
              >
                {saveTokenMut.isPending ? "Connecting..." : "Connect"}
              </Button>
              {showUpdateToken && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowUpdateToken(false)}
                >
                  Cancel
                </Button>
              )}
            </div>
            {saveTokenMut.isError && (
              <ConnectionResultMessage tone="error">
                {saveTokenMut.error.message}
              </ConnectionResultMessage>
            )}
          </div>
        )}

        {isConnected && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => testConnectionMut.mutate()}
              disabled={testConnectionMut.isPending}
            >
              {testConnectionMut.isPending ? "Testing..." : "Test"}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => syncNowMut.mutate()}
              disabled={syncNowMut.isPending}
              title="Pull current balances and update today's snapshot"
            >
              {syncNowMut.isPending ? "Syncing..." : "Sync Now"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowUpdateToken(!showUpdateToken)}
            >
              {showUpdateToken ? "Hide" : "Reconnect"}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={handleRemove}
              disabled={removeConnectionMut.isPending}
            >
              Remove
            </Button>
          </div>
        )}

        {testConnectionMut.isSuccess && testConnectionMut.data && (
          <ConnectionResultMessage
            tone={testConnectionMut.data.success ? "success" : "error"}
          >
            {testConnectionMut.data.success
              ? `Connected: ${testConnectionMut.data.accountCount} linked account(s)`
              : testConnectionMut.data.error}
          </ConnectionResultMessage>
        )}

        {syncNowMut.isSuccess && syncNowMut.data && (
          <ConnectionResultMessage tone="success">
            Synced {syncNowMut.data.accountCount} account(s), total{" "}
            {formatCurrency(syncNowMut.data.totalBalance)}
          </ConnectionResultMessage>
        )}
        {syncNowMut.isError && (
          <ConnectionResultMessage tone="error">
            {syncNowMut.error.message}
          </ConnectionResultMessage>
        )}

        {isConnected && accounts && accounts.length > 0 && (
          <div className="border-subtle space-y-3 border-t pt-3">
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
                <p className="text-muted mb-1 text-xs font-medium">
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
