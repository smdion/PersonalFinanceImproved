/** The portfolio mapping section's lists: mapped labels, rollups, the
 *  unmapped tracking accounts and the new mapping's options. */
import { formatCurrency } from "@/lib/utils/format";
import { Badge } from "@/components/ui/badge";
import {
  allowedDirectionsForLocalId,
  mappingsWithTypedIds,
} from "@/lib/pure/sync/account-mapping";
import type { PreviewData, Service } from "../integrations-types";
import type { IntegrationPortfolioMutations } from "./use-integration-portfolio-mutations";

/** A mapping's Ledgr-side label: the debt's or mortgage's name, or its own. */
export function mappedLocalLabel(
  m: NonNullable<PreviewData["portfolio"]>["existingMappings"][number],
  portfolio: NonNullable<PreviewData["portfolio"]>,
) {
  const lid = m.localId ?? m.localName;
  const dm = lid.match(/^debt:(\d+)$/);
  if (dm) {
    return (
      portfolio.debtAccounts.find((d) => d.id === Number(dm[1]))?.label ??
      m.localName
    );
  }
  const mm = lid.match(/^mortgage:(\d+):(\w+)$/);
  if (mm) {
    return (
      portfolio.mortgageAccounts.find(
        (ma) => ma.id === Number(mm[1]) && ma.type === mm[2],
      )?.label ?? m.localName
    );
  }
  return m.localName;
}

/** Which Ledgr accounts roll up into each tracking account. */
export function renderRollupSummary(
  portfolio: NonNullable<PreviewData["portfolio"]>,
) {
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
    <div className="text-caption text-faint space-y-0.5">
      {multiRollups.map(([remoteId, names]) => {
        const tracking = portfolio.trackingAccounts.find(
          (a) => a.id === remoteId,
        );
        const localTotal = names.reduce((sum, n) => {
          const localAccount = portfolio.localAccounts.find(
            (a) => a.label === n,
          );
          if (localAccount) return sum + localAccount.balance;
          const assetAccount = portfolio.assetAccounts.find(
            (a) => a.label === n,
          );
          if (assetAccount) return sum + assetAccount.balance;
          const mortgageAccount = portfolio.mortgageAccounts.find(
            (a) => a.label === n,
          );
          if (mortgageAccount) return sum + mortgageAccount.value;
          const debtAccount = portfolio.debtAccounts.find((a) => a.label === n);
          if (debtAccount) return sum + debtAccount.value;
          return sum;
        }, 0);
        return (
          <div key={remoteId}>
            {names.join(" + ")} = {formatCurrency(localTotal)} &rarr;{" "}
            {tracking?.name ?? "Unknown"}
            {names.some(
              (n) =>
                portfolio.mortgageAccounts.find((a) => a.label === n)
                  ?.fedBySimplefin,
            ) && " (paused: SimpleFIN reports this loan)"}
          </div>
        );
      })}
    </div>
  );
}

/** The tracking accounts with no mapping, each with its map or create controls. */
export function renderUnmappedTracking(
  portfolio: NonNullable<PreviewData["portfolio"]>,
  mappedRemoteIds: Set<string>,
  createAssetAndMapMut: IntegrationPortfolioMutations["createAssetAndMap"],
  service: Service,
  updateMappingsMut: IntegrationPortfolioMutations["updateMappings"],
) {
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
    ...portfolio.assetAccounts.map((a) => ({
      localId: `asset:${a.id}`,
      localName: a.label,
    })),
    // A loan SimpleFIN reports can't also be pulled from here.
    ...portfolio.mortgageAccounts
      .filter((m) => !m.fedBySimplefin)
      .map((m) => ({
        localId: `mortgage:${m.id}:${m.type}`,
        localName: m.label,
      })),
    ...portfolio.debtAccounts.map((d) => ({
      localId: `debt:${d.id}`,
      localName: d.label,
    })),
  ];
  const mappedLocalKeys = new Set(
    portfolio.existingMappings.map((m) => `${m.localId ?? ""}|${m.localName}`),
  );
  const availableLocal = allLocalOptions.filter(
    (l) => !mappedLocalKeys.has(`${l.localId}|${l.localName}`),
  );

  return (
    <div className="border-subtle space-y-1 border-t pt-2">
      <p className="text-caption text-muted font-medium">
        Unmapped tracking accounts ({unmappedTracking.length})
      </p>
      <div className="space-y-1">
        {unmappedTracking.map((t) => (
          <div key={t.id} className="space-y-0.5">
            <div className="flex items-center gap-1.5 text-xs">
              <Badge
                color="purple"
                size="sm"
                case="normal"
                className="whitespace-nowrap"
              >
                API only
              </Badge>
              <span className="text-muted flex-1 truncate">{t.name}</span>
              <span className="text-faint text-caption whitespace-nowrap tabular-nums">
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
                className="text-caption rounded bg-blue-50 px-1.5 py-0.5 whitespace-nowrap text-blue-600 hover:bg-blue-100 disabled:opacity-50"
              >
                + Create Asset
              </button>
            </div>
            {availableLocal.length > 0 && (
              <div className="flex items-center gap-1 pl-14">
                <select
                  aria-label="Link to existing account"
                  defaultValue=""
                  onChange={(e) => {
                    if (!e.target.value) return;
                    // Match localId+localName: localId alone is
                    // shared by two owners of one performance account.
                    const opt = availableLocal.find(
                      (o) => `${o.localId}|${o.localName}` === e.target.value,
                    );
                    if (!opt) return;
                    const updated = [
                      ...portfolio.existingMappings,
                      {
                        localId: opt.localId,
                        localName: opt.localName,
                        remoteAccountId: t.id,
                        syncDirection: allowedDirectionsForLocalId(
                          opt.localId,
                        ).includes("pull")
                          ? ("pull" as const)
                          : ("push" as const),
                      },
                    ];
                    updateMappingsMut.mutate({
                      service,
                      mappings: mappingsWithTypedIds(updated),
                    });
                  }}
                  className="text-caption bg-surface-primary flex-1 rounded border px-1 py-0.5"
                >
                  <option value="">Link to existing...</option>
                  {availableLocal.map((l) => (
                    <option
                      key={`${l.localId}|${l.localName}`}
                      value={`${l.localId}|${l.localName}`}
                    >
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
}

/** The new mapping's Ledgr account options, without those already mapped. */
export function renderLocalAccountOptions(
  portfolio: NonNullable<PreviewData["portfolio"]>,
) {
  // Build set of mapped identities using "localId|localName" composite
  // so two accounts sharing the same performanceAccountId (e.g. two IRAs
  // at the same institution owned by different people) are distinguished.
  const mappedKeys = new Set(
    portfolio.existingMappings.map((m) => `${m.localId ?? ""}|${m.localName}`),
  );
  const unmappedPortfolio = portfolio.localAccounts.filter(
    (a) =>
      a.performanceAccountId != null &&
      !mappedKeys.has(`performance:${a.performanceAccountId}|${a.label}`),
  );
  const unmappedAssets = portfolio.assetAccounts.filter(
    (a) => !mappedKeys.has(`asset:${a.id}|${a.label}`),
  );
  const unmappedMortgages = portfolio.mortgageAccounts.filter(
    (m) => !mappedKeys.has(`mortgage:${m.id}:${m.type}|${m.label}`),
  );
  const unmappedDebts = portfolio.debtAccounts.filter(
    (d) => !mappedKeys.has(`debt:${d.id}|${d.label}`),
  );
  return (
    <>
      {unmappedPortfolio.length > 0 && (
        <optgroup label="Portfolio Accounts">
          {unmappedPortfolio.map((a) => (
            <option
              // Key on (performanceAccountId, ownerPersonId), the server's dedupe tuple;
              // `value` stays label-based because AccountMapping has no ownerPersonId,
              // so localName is what tells two owners' mappings apart.
              key={`p:${a.performanceAccountId}:${a.ownerPersonId ?? ""}`}
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
            <option key={`a:${a.id}`} value={`asset:${a.id}|${a.label}`}>
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
      {unmappedDebts.length > 0 && (
        <optgroup label="Debts">
          {unmappedDebts.map((d) => (
            <option key={`d:${d.id}`} value={`debt:${d.id}|${d.label}`}>
              {d.label} ({formatCurrency(d.value)})
            </option>
          ))}
        </optgroup>
      )}
      {/* Fixed pseudo-accounts many on-budget accounts can share (summed by
       * getEffectiveCash/getEffectiveCreditCardDebt); never hidden by
       * mappedKeys, since several mappings to one bucket are normal. */}
      <optgroup label="Cash / Credit Card">
        <option value="cash|Cash">Cash (combine accounts)</option>
        <option value="creditCard|Credit Card">
          Credit Card (combine accounts)
        </option>
      </optgroup>
    </>
  );
}

/** The new mapping's budget account options for the picked Ledgr account. */
export function renderRemoteAccountOptions(
  newPortfolioIsCashOrCredit: boolean,
  portfolio: NonNullable<PreviewData["portfolio"]>,
  newPortfolioLocal: string,
) {
  if (!newPortfolioIsCashOrCredit) {
    return portfolio.trackingAccounts.map((a) => (
      <option key={a.id} value={a.id}>
        {a.name} ({formatCurrency(a.balance)})
      </option>
    ));
  }
  // Cash/Credit Card map to on-budget accounts (not in trackingAccounts), so
  // offer the full list minus accounts already in this bucket.
  const bucketLocalId = newPortfolioLocal.split("|")[0];
  const alreadyInBucket = new Set(
    portfolio.existingMappings
      .filter((m) => m.localId === bucketLocalId)
      .map((m) => m.remoteAccountId),
  );
  return portfolio.allAccounts
    .filter((a) => !alreadyInBucket.has(a.id))
    .map((a) => (
      <option key={a.id} value={a.id}>
        {a.name} ({formatCurrency(a.balance)})
      </option>
    ));
}
