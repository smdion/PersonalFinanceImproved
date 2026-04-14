"use client";

/**
 * Portfolio → tracking-account-mappings section of the integrations
 * preview panel. Lets the user wire up Ledgr performance/asset/mortgage
 * accounts to the budget API's tracking accounts, plus toggle sync
 * direction per mapping and create assets from unmapped remote accounts.
 *
 * Owns its own local state for the "Add new mapping" builder row
 * (local/remote/direction selects).
 */
import React, { useState } from "react";
import { formatCurrency } from "@/lib/utils/format";
import { mappingsWithTypedIds } from "@/lib/utils/account-mapping";
import type { PreviewData, Service } from "../integrations-types";
import type { PortfolioMutations } from "./hooks/use-portfolio-mutations";

type Props = {
  service: Service;
  portfolio: NonNullable<PreviewData["portfolio"]>;
  mutations: PortfolioMutations;
};

export function PortfolioSection({ service, portfolio, mutations }: Props) {
  const {
    updateMappings: updateMappingsMut,
    createAssetAndMap: createAssetAndMapMut,
  } = mutations;

  const [newPortfolioLocal, setNewPortfolioLocal] = useState("");
  const [newPortfolioRemote, setNewPortfolioRemote] = useState("");
  const [newPortfolioDirection, setNewPortfolioDirection] = useState<
    "push" | "pull" | "both"
  >("push");

  if (portfolio.trackingAccounts.length === 0) return null;

  const mappedRemoteIds = new Set(
    portfolio.existingMappings.map((m) => m.remoteAccountId),
  );
  const unmappedCount = portfolio.trackingAccounts.filter(
    (a) => !mappedRemoteIds.has(a.id),
  ).length;
  const totalTracking = portfolio.trackingAccounts.length;
  const mappedCount = totalTracking - unmappedCount;

  return (
    <details className="border border-subtle rounded-lg">
      <summary className="px-3 py-2.5 cursor-pointer select-none flex items-center justify-between">
        <span className="text-xs font-medium text-muted">
          Tracking Account Mappings
        </span>
        {unmappedCount === 0 ? (
          <span className="text-[10px] text-green-400">
            {totalTracking}/{totalTracking} mapped
          </span>
        ) : (
          <span className="text-[10px] text-amber-400">
            {mappedCount}/{totalTracking} mapped
          </span>
        )}
      </summary>
      <div className="px-3 pb-3 space-y-2">
        {/* Existing mappings */}
        {portfolio.existingMappings.length > 0 && (
          <div className="space-y-0.5">
            {portfolio.existingMappings.map((m, i) => {
              const tracking = portfolio.trackingAccounts.find(
                (a) => a.id === m.remoteAccountId,
              );
              return (
                <div
                  key={m.localId ?? m.localName}
                  className="flex items-center gap-1.5 text-xs bg-green-50 rounded px-2 py-1"
                >
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 whitespace-nowrap">
                    Mapped
                  </span>
                  <span className="text-secondary truncate flex-1">
                    {(() => {
                      const lid = m.localId ?? m.localName;
                      const mm = lid.match(/^mortgage:(\d+):(\w+)$/);
                      if (mm) {
                        return (
                          portfolio.mortgageAccounts?.find(
                            (ma) =>
                              ma.id === Number(mm[1]) && ma.type === mm[2],
                          )?.label ?? m.localName
                        );
                      }
                      return m.localName;
                    })()}
                  </span>
                  <span className="text-faint">&rarr;</span>
                  <span className="text-muted truncate flex-1">
                    {tracking?.name ?? m.remoteAccountId.slice(0, 12) + "..."}
                  </span>
                  <button
                    onClick={() => {
                      const next =
                        m.syncDirection === "pull"
                          ? "push"
                          : m.syncDirection === "push"
                            ? "both"
                            : "pull";
                      const updated = portfolio.existingMappings.map((em, j) =>
                        j === i
                          ? {
                              ...em,
                              syncDirection: next as "pull" | "push" | "both",
                            }
                          : em,
                      );
                      updateMappingsMut.mutate({
                        service,
                        mappings: mappingsWithTypedIds(updated),
                      });
                    }}
                    disabled={updateMappingsMut.isPending}
                    className={`text-[10px] px-1 py-0.5 rounded disabled:opacity-50 ${
                      m.syncDirection === "push"
                        ? "bg-green-100 text-green-600 hover:bg-green-200"
                        : m.syncDirection === "pull"
                          ? "bg-blue-100 text-blue-600 hover:bg-blue-200"
                          : "bg-purple-100 text-purple-600 hover:bg-purple-200"
                    }`}
                    title={`Sync: ${m.syncDirection} (click to change)`}
                  >
                    {m.syncDirection === "push"
                      ? "← push"
                      : m.syncDirection === "both"
                        ? "⇄ both"
                        : "→ pull"}
                  </button>
                  {tracking && (
                    <span className="text-faint tabular-nums text-[10px] whitespace-nowrap">
                      {formatCurrency(tracking.balance)}
                    </span>
                  )}
                  <button
                    onClick={() => {
                      const updated = portfolio.existingMappings.filter(
                        (_, j) => j !== i,
                      );
                      updateMappingsMut.mutate({
                        service,
                        mappings: mappingsWithTypedIds(updated),
                      });
                    }}
                    className="text-red-400 hover:text-red-600 text-xs"
                  >
                    &times;
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Rollup summary: show which local accounts aggregate to each tracking account */}
        {portfolio.existingMappings.length > 1 &&
          (() => {
            const rollups = new Map<string, string[]>();
            for (const m of portfolio.existingMappings) {
              const list = rollups.get(m.remoteAccountId) ?? [];
              list.push(m.localName); // Display name for rollup
              rollups.set(m.remoteAccountId, list);
            }
            const multiRollups = Array.from(rollups.entries()).filter(
              ([, names]) => names.length > 1,
            );
            if (multiRollups.length === 0) return null;
            return (
              <div className="text-[10px] text-faint space-y-0.5">
                {multiRollups.map(([remoteId, names]) => {
                  const tracking = portfolio.trackingAccounts.find(
                    (a) => a.id === remoteId,
                  );
                  const localTotal = names.reduce((sum, n) => {
                    const acct = portfolio.localAccounts.find(
                      (a) => a.label === n,
                    );
                    return sum + (acct?.balance ?? 0);
                  }, 0);
                  return (
                    <div key={remoteId}>
                      {names.join(" + ")} = {formatCurrency(localTotal)} &rarr;{" "}
                      {tracking?.name ?? "Unknown"}
                    </div>
                  );
                })}
              </div>
            );
          })()}

        {/* Unmapped tracking accounts */}
        {(() => {
          const unmappedTracking = portfolio.trackingAccounts.filter(
            (a) => !mappedRemoteIds.has(a.id),
          );
          if (unmappedTracking.length === 0) return null;

          // Build available local options with { localId, localName } pairs
          const allLocalOptions: { localId: string; localName: string }[] = [
            ...portfolio.localAccounts
              .filter((a) => a.performanceAccountId != null)
              .map((a) => ({
                localId: `performance:${a.performanceAccountId}`,
                localName: a.label,
              })),
            ...(portfolio.assetAccounts ?? []).map((a) => ({
              localId: `asset:${a.id}`,
              localName: a.label,
            })),
            ...(portfolio.mortgageAccounts ?? []).map((m) => ({
              localId: `mortgage:${m.id}:${m.type}`,
              localName: m.label,
            })),
          ];
          const mappedLocalKeys = new Set(
            portfolio.existingMappings.map(
              (m) => `${m.localId ?? ""}|${m.localName}`,
            ),
          );
          const availableLocal = allLocalOptions.filter(
            (l) => !mappedLocalKeys.has(`${l.localId}|${l.localName}`),
          );

          return (
            <div className="border-t border-subtle pt-2 space-y-1">
              <p className="text-[10px] font-medium text-muted">
                Unmapped tracking accounts ({unmappedTracking.length})
              </p>
              <div className="space-y-1">
                {unmappedTracking.map((t) => (
                  <div key={t.id} className="space-y-0.5">
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 whitespace-nowrap">
                        API only
                      </span>
                      <span className="text-muted truncate flex-1">
                        {t.name}
                      </span>
                      <span className="text-faint tabular-nums text-[10px] whitespace-nowrap">
                        {formatCurrency(t.balance)}
                      </span>
                      <button
                        onClick={() =>
                          createAssetAndMapMut.mutate({
                            service,
                            assetName: t.name,
                            balance: t.balance,
                            remoteAccountId: t.id,
                            syncDirection: "pull",
                          })
                        }
                        disabled={createAssetAndMapMut.isPending}
                        className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded hover:bg-blue-100 whitespace-nowrap disabled:opacity-50"
                      >
                        + Create Asset
                      </button>
                    </div>
                    {availableLocal.length > 0 && (
                      <div className="flex items-center gap-1 pl-14">
                        <select
                          defaultValue=""
                          onChange={(e) => {
                            if (!e.target.value) return;
                            const opt = availableLocal.find(
                              (o) => o.localId === e.target.value,
                            );
                            if (!opt) return;
                            const updated = [
                              ...portfolio.existingMappings,
                              {
                                localId: opt.localId,
                                localName: opt.localName,
                                remoteAccountId: t.id,
                                syncDirection: "pull" as const,
                              },
                            ];
                            updateMappingsMut.mutate({
                              service,
                              mappings: mappingsWithTypedIds(updated),
                            });
                          }}
                          className="flex-1 px-1 py-0.5 text-[10px] border rounded bg-surface-primary"
                        >
                          <option value="">Link to existing...</option>
                          {availableLocal.map((l) => (
                            <option key={l.localId} value={l.localId}>
                              {l.localName}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Add new mapping */}
        <div className="flex gap-1 items-end flex-wrap border-t border-subtle pt-2">
          <div className="flex-1 min-w-[100px]">
            <label className="block text-[10px] font-medium text-muted mb-0.5">
              Ledgr Account
            </label>
            <select
              value={newPortfolioLocal}
              onChange={(e) => setNewPortfolioLocal(e.target.value)}
              className="w-full px-1 py-1 text-[11px] border border-strong rounded bg-surface-primary"
            >
              <option value="">Select...</option>
              {(() => {
                // Build set of mapped identities using "localId|localName" composite
                // so two accounts sharing the same performanceAccountId (e.g. two IRAs
                // at the same institution owned by different people) are distinguished.
                const mappedKeys = new Set(
                  portfolio.existingMappings.map(
                    (m) => `${m.localId ?? ""}|${m.localName}`,
                  ),
                );
                const unmappedPortfolio = portfolio.localAccounts.filter(
                  (a) =>
                    a.performanceAccountId != null &&
                    !mappedKeys.has(
                      `performance:${a.performanceAccountId}|${a.label}`,
                    ),
                );
                const unmappedAssets = (portfolio.assetAccounts ?? []).filter(
                  (a) => !mappedKeys.has(`asset:${a.id}|${a.label}`),
                );
                const unmappedMortgages = (
                  portfolio.mortgageAccounts ?? []
                ).filter(
                  (m) =>
                    !mappedKeys.has(`mortgage:${m.id}:${m.type}|${m.label}`),
                );
                return (
                  <>
                    {unmappedPortfolio.length > 0 && (
                      <optgroup label="Portfolio Accounts">
                        {unmappedPortfolio.map((a) => (
                          <option
                            key={`p:${a.performanceAccountId}`}
                            value={`performance:${a.performanceAccountId}|${a.label}`}
                          >
                            {a.label} ({formatCurrency(a.balance)})
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {unmappedAssets.length > 0 && (
                      <optgroup label="Assets / Liabilities">
                        {unmappedAssets.map((a) => (
                          <option
                            key={`a:${a.id}`}
                            value={`asset:${a.id}|${a.label}`}
                          >
                            {a.label} ({formatCurrency(a.balance)})
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {unmappedMortgages.length > 0 && (
                      <optgroup label="Mortgage Properties">
                        {unmappedMortgages.map((m) => (
                          <option
                            key={`m:${m.id}:${m.type}`}
                            value={`mortgage:${m.id}:${m.type}|${m.label}`}
                          >
                            {m.label} ({formatCurrency(m.value)})
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </>
                );
              })()}
            </select>
          </div>
          <div className="flex-1 min-w-[100px]">
            <label className="block text-[10px] font-medium text-muted mb-0.5">
              Tracking Account
            </label>
            <select
              value={newPortfolioRemote}
              onChange={(e) => setNewPortfolioRemote(e.target.value)}
              className="w-full px-1 py-1 text-[11px] border border-strong rounded bg-surface-primary"
            >
              <option value="">Select...</option>
              {portfolio.trackingAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({formatCurrency(a.balance)})
                </option>
              ))}
            </select>
          </div>
          <div className="w-16">
            <label className="block text-[10px] font-medium text-muted mb-0.5">
              Dir
            </label>
            <select
              value={newPortfolioDirection}
              onChange={(e) =>
                setNewPortfolioDirection(
                  e.target.value as "push" | "pull" | "both",
                )
              }
              className="w-full px-1 py-1 text-[11px] border border-strong rounded bg-surface-primary"
            >
              <option value="push">Push</option>
              <option value="pull">Pull</option>
              <option value="both">Both</option>
            </select>
          </div>
          <button
            onClick={() => {
              if (!newPortfolioLocal || !newPortfolioRemote) return;
              // Value format: "localId|localName"
              const pipeIdx = newPortfolioLocal.indexOf("|");
              const localId =
                pipeIdx >= 0
                  ? newPortfolioLocal.slice(0, pipeIdx)
                  : newPortfolioLocal;
              const localName =
                pipeIdx >= 0
                  ? newPortfolioLocal.slice(pipeIdx + 1)
                  : newPortfolioLocal;
              const updated = [
                ...portfolio.existingMappings,
                {
                  localId,
                  localName,
                  remoteAccountId: newPortfolioRemote,
                  syncDirection: newPortfolioDirection,
                },
              ];
              updateMappingsMut.mutate({
                service,
                mappings: mappingsWithTypedIds(updated),
              });
              setNewPortfolioLocal("");
              setNewPortfolioRemote("");
            }}
            disabled={
              !newPortfolioLocal ||
              !newPortfolioRemote ||
              updateMappingsMut.isPending
            }
            className="px-2 py-1 text-[11px] bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>
    </details>
  );
}
