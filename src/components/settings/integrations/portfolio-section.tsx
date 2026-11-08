"use client";

/**
 * Portfolio → tracking-account-mappings section of the integrations
 * preview panel. Lets the user wire up Ledgr performance/asset/mortgage/debt
 * accounts to the budget API's tracking accounts, plus toggle sync
 * direction per mapping and create assets from unmapped remote accounts.
 *
 * Owns its own local state for the "Add new mapping" builder row
 * (local/remote/direction selects).
 */
import React, { useState } from "react";
import { formatCurrency } from "@/lib/utils/format";
import {
  allowedDirectionsForLocalId,
  allowedDirectionsForMapping,
  isPullOnlyLocalId,
  mappingsWithTypedIds,
} from "@/lib/pure/sync/account-mapping";
import type { PreviewData, Service } from "../integrations-types";
import type { PortfolioMutations } from "./use-portfolio-mutations";
import { Badge } from "@/components/ui/badge";
import {
  SectionSummaryBadge,
  SectionSummaryRow,
} from "./section-summary-badge";
import {
  mappedLocalLabel,
  renderRollupSummary,
  renderUnmappedTracking,
  renderLocalAccountOptions,
  renderRemoteAccountOptions,
} from "./portfolio-mapping-lists";

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

  // Was re-derived 4x below with the identical two-way startsWith check.
  // Cash, Credit Card and debts only pull (Ledgr has no figure of its own
  // to push to them) and can be any budget account, on-budget included.
  const newPortfolioIsCashOrCredit = isPullOnlyLocalId(
    newPortfolioLocal.split("|")[0] ?? "",
  );

  // Directions the picked Ledgr account allows (a portfolio account is push
  // only; Cash, Credit Card and debts pull only). Empty pick: no limit.
  const newPortfolioAllowed = allowedDirectionsForLocalId(
    newPortfolioLocal.split("|")[0] ?? "",
  );

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
    <details className="border-subtle rounded-lg border">
      <summary className="flex cursor-pointer items-center justify-between px-3 py-2.5 select-none">
        <span className="text-muted text-xs font-medium">
          Tracking Account Mappings
        </span>
        <SectionSummaryRow>
          <SectionSummaryBadge
            value={mappedCount}
            label="mapped"
            tone="green"
          />
          {unmappedCount > 0 && (
            <SectionSummaryBadge
              value={unmappedCount}
              label="unmapped"
              tone="amber"
            />
          )}
        </SectionSummaryRow>
      </summary>
      <div className="space-y-2 px-3 pb-3">
        {/* Existing mappings */}
        {portfolio.existingMappings.length > 0 && (
          <div className="space-y-0.5">
            {portfolio.existingMappings.map((m, i) => {
              // Cash/Credit Card map to on-budget accounts, which live in
              // allAccounts, not trackingAccounts (off-budget only) — fall
              // back to allAccounts so these rows show a real name instead
              // of a truncated remote id.
              const tracking =
                portfolio.trackingAccounts.find(
                  (a) => a.id === m.remoteAccountId,
                ) ??
                portfolio.allAccounts.find((a) => a.id === m.remoteAccountId);
              return (
                <div
                  // remoteAccountId included: many Cash/Credit Card rows
                  // legitimately share the same localId+localName, so that
                  // pair alone isn't a unique key here.
                  key={`${m.localId ?? ""}|${m.localName}|${m.remoteAccountId}`}
                  className="flex items-center gap-1.5 rounded bg-green-50 px-2 py-1 text-xs"
                >
                  <Badge
                    color="green"
                    size="sm"
                    case="normal"
                    className="whitespace-nowrap"
                  >
                    Mapped
                  </Badge>
                  <span className="text-secondary flex-1 truncate">
                    {mappedLocalLabel(m, portfolio)}
                  </span>
                  <span className="text-faint">&rarr;</span>
                  <span className="text-muted flex-1 truncate">
                    {tracking?.name ?? m.remoteAccountId.slice(0, 12) + "..."}
                  </span>
                  {/* Cash/Credit Card/debts are pull-only — Ledgr has no single
                   * "Cash total" value to push TO one specific remote
                   * account — and portfolio accounts push-only (a pull would
                   * double-count them as an asset), so the toggle is fixed
                   * rather than cyclable into a state the target refuses. */}
                  {allowedDirectionsForMapping(m).length === 1 ? (
                    <Badge
                      color={
                        allowedDirectionsForMapping(m)[0] === "push"
                          ? "green"
                          : "blue"
                      }
                      size="sm"
                      case="normal"
                      className="whitespace-nowrap"
                    >
                      {allowedDirectionsForMapping(m)[0] === "push"
                        ? "\u2190 push"
                        : "\u2192 pull"}
                    </Badge>
                  ) : (
                    <button
                      onClick={() => {
                        const next =
                          m.syncDirection === "pull"
                            ? "push"
                            : m.syncDirection === "push"
                              ? "both"
                              : "pull";
                        const updated = portfolio.existingMappings.map(
                          (em, j) =>
                            j === i
                              ? {
                                  ...em,
                                  syncDirection: next as
                                    "pull" | "push" | "both",
                                }
                              : em,
                        );
                        updateMappingsMut.mutate({
                          service,
                          mappings: mappingsWithTypedIds(updated),
                        });
                      }}
                      disabled={updateMappingsMut.isPending}
                      className={`text-caption rounded px-1 py-0.5 disabled:opacity-50 ${
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
                  )}
                  {tracking && (
                    <span className="text-faint text-caption whitespace-nowrap tabular-nums">
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
                    className="text-xs text-red-400 hover:text-red-600"
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
          renderRollupSummary(portfolio)}

        {/* Unmapped tracking accounts */}
        {renderUnmappedTracking(
          portfolio,
          mappedRemoteIds,
          createAssetAndMapMut,
          service,
          updateMappingsMut,
        )}

        {/* Add new mapping */}
        <div className="border-subtle flex flex-wrap items-end gap-1 border-t pt-2">
          <div className="min-w-[100px] flex-1">
            <label className="text-caption text-muted mb-0.5 block font-medium">
              Ledgr Account
            </label>
            <select
              value={newPortfolioLocal}
              onChange={(e) => setNewPortfolioLocal(e.target.value)}
              className="text-label border-strong bg-surface-primary w-full rounded border px-1 py-1"
            >
              <option value="">Select...</option>
              {renderLocalAccountOptions(portfolio)}
            </select>
          </div>
          <div className="min-w-[100px] flex-1">
            <label className="text-caption text-muted mb-0.5 block font-medium">
              {newPortfolioIsCashOrCredit ? "Account" : "Tracking Account"}
            </label>
            <select
              value={newPortfolioRemote}
              onChange={(e) => setNewPortfolioRemote(e.target.value)}
              className="text-label border-strong bg-surface-primary w-full rounded border px-1 py-1"
            >
              <option value="">Select...</option>
              {renderRemoteAccountOptions(
                newPortfolioIsCashOrCredit,
                portfolio,
                newPortfolioLocal,
              )}
            </select>
          </div>
          <div className="w-16">
            <label className="text-caption text-muted mb-0.5 block font-medium">
              Dir
            </label>
            {newPortfolioAllowed.length === 1 ? (
              // One allowed direction — see the fixed-direction note on
              // existing rows above.
              <div className="text-label border-strong bg-surface-sunken text-faint w-full rounded border px-1 py-1">
                {newPortfolioAllowed[0] === "push" ? "Push" : "Pull"}
              </div>
            ) : (
              <select
                value={newPortfolioDirection}
                onChange={(e) =>
                  setNewPortfolioDirection(
                    e.target.value as "push" | "pull" | "both",
                  )
                }
                className="text-label border-strong bg-surface-primary w-full rounded border px-1 py-1"
              >
                <option value="push">Push</option>
                <option value="pull">Pull</option>
                <option value="both">Both</option>
              </select>
            )}
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
                  syncDirection: allowedDirectionsForLocalId(localId).includes(
                    newPortfolioDirection,
                  )
                    ? newPortfolioDirection
                    : allowedDirectionsForLocalId(localId)[0]!,
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
            className="text-label rounded bg-blue-600 px-2 py-1 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>
    </details>
  );
}
