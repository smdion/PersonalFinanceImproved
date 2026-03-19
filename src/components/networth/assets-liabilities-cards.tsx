"use client";

import { Card } from "@/components/ui/card";
import { InlineEdit } from "@/components/ui/inline-edit";
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency } from "@/lib/utils/format";
import { taxTypeLabel } from "@/lib/utils/colors";

export function AssetsLiabilitiesCards({
  portfolioTotal,
  portfolioAccounts,
  byTaxType,
  cash,
  cashSource,
  displayHomeValue,
  otherAssets,
  otherAssetItems,
  otherAssetsSyncSource,
  mortgageBalance,
  otherLiabilities,
  totalLiabilities,
  useMarketValue,
  hasHouse,
  onSettingUpdate,
}: {
  portfolioTotal: number;
  portfolioAccounts: { taxType: string; amount: number }[];
  byTaxType: Map<string, number>;
  cash: number;
  cashSource: "ynab" | "actual" | "manual";
  displayHomeValue: number;
  otherAssets: number;
  otherAssetItems?: { name: string; value: number; synced: boolean }[];
  otherAssetsSyncSource?: string | null;
  mortgageBalance: number;
  otherLiabilities: number;
  totalLiabilities: number;
  useMarketValue: boolean;
  hasHouse: boolean;
  onSettingUpdate: (key: string, value: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
      <Card title="Assets">
        <div className="space-y-2 text-sm">
          <div className="group relative flex justify-between py-1 border-b border-subtle cursor-default">
            <span className="text-muted">
              Investment Portfolio
              <span className="text-faint text-xs ml-1 opacity-0 group-hover:opacity-100 transition-opacity">
                &#9432;
              </span>
            </span>
            <span className="font-medium">
              {formatCurrency(portfolioTotal)}
            </span>
            {byTaxType.size > 0 && (
              <div className="absolute left-0 top-full mt-1 z-10 bg-surface-primary border rounded-lg shadow-lg p-3 min-w-[220px] hidden group-hover:block">
                <p className="text-xs font-medium text-muted mb-2">
                  By Tax Type
                </p>
                {Array.from(byTaxType.entries())
                  .sort((a, b) => b[1] - a[1])
                  .map(([type, amount]) => (
                    <div
                      key={type}
                      className="flex justify-between text-xs py-0.5"
                    >
                      <span className="text-muted">{taxTypeLabel(type)}</span>
                      <span className="font-medium">
                        {formatCurrency(amount)}
                      </span>
                    </div>
                  ))}
                <div className="border-t border-subtle mt-1 pt-1 flex justify-between text-xs font-semibold">
                  <span>Total</span>
                  <span>{formatCurrency(portfolioTotal)}</span>
                </div>
                <p className="text-[10px] text-faint mt-1">
                  {portfolioAccounts.length} accounts
                </p>
              </div>
            )}
          </div>
          <div className="flex justify-between items-center py-1 border-b border-subtle">
            <span className="text-muted">
              Cash
              {cashSource !== "manual" && (
                <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-600">
                  Synced from {cashSource.toUpperCase()}
                </span>
              )}
            </span>
            {cashSource === "manual" ? (
              <InlineEdit
                value={String(cash)}
                onSave={(v) => onSettingUpdate("current_cash", v)}
                formatDisplay={(v) => formatCurrency(Number(v))}
                parseInput={(v) => v.replace(/[^0-9.]/g, "")}
                type="number"
                className="font-medium"
              />
            ) : (
              <span className="font-medium">{formatCurrency(cash)}</span>
            )}
          </div>
          {hasHouse && (
            <div className="flex justify-between py-1 border-b border-subtle">
              <span className="text-muted">
                Home {useMarketValue ? "(Market)" : "(Cost Basis)"}
              </span>
              <span className="font-medium">
                {formatCurrency(displayHomeValue)}
              </span>
            </div>
          )}
          {otherAssetItems && otherAssetItems.length > 0 ? (
            otherAssetItems.map((item) => (
              <div
                key={item.name}
                className="flex justify-between items-center py-1 border-b border-subtle"
              >
                <span className="text-muted">
                  {item.name}
                  {item.synced && otherAssetsSyncSource && (
                    <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-600">
                      Synced from {otherAssetsSyncSource.toUpperCase()}
                    </span>
                  )}
                </span>
                <span className="font-medium">
                  {formatCurrency(item.value)}
                </span>
              </div>
            ))
          ) : otherAssets > 0 ? (
            <div className="flex justify-between items-center py-1 border-b border-subtle">
              <span className="text-muted">Other Assets</span>
              <InlineEdit
                value={String(otherAssets)}
                onSave={(v) => onSettingUpdate("current_other_assets", v)}
                formatDisplay={(v) => formatCurrency(Number(v))}
                parseInput={(v) => v.replace(/[^0-9.]/g, "")}
                type="number"
                className="font-medium"
              />
            </div>
          ) : null}
          <div className="flex justify-between py-1 font-semibold">
            <span>Total Assets</span>
            <span>
              {formatCurrency(
                portfolioTotal + cash + displayHomeValue + otherAssets,
              )}
            </span>
          </div>
        </div>
      </Card>

      <Card title="Liabilities">
        <div className="space-y-2 text-sm">
          {hasHouse && (
            <div className="flex justify-between py-1 border-b border-subtle">
              <span className="text-muted">Mortgage Balance</span>
              <span className="font-medium">
                {formatCurrency(mortgageBalance)}
              </span>
            </div>
          )}
          {otherLiabilities > 0 && (
            <div className="flex justify-between items-center py-1 border-b border-subtle">
              <span className="text-muted">Other Liabilities</span>
              <InlineEdit
                value={String(otherLiabilities)}
                onSave={(v) => onSettingUpdate("current_other_liabilities", v)}
                formatDisplay={(v) => formatCurrency(Number(v))}
                parseInput={(v) => v.replace(/[^0-9.]/g, "")}
                type="number"
                className="font-medium"
              />
            </div>
          )}
          <div className="flex justify-between py-1 font-semibold">
            <span>Total Liabilities</span>
            <span>{formatCurrency(totalLiabilities)}</span>
          </div>
        </div>
        {hasHouse && (
          <div className="mt-3 pt-3 border-t border-subtle">
            <div className="flex justify-between text-sm">
              <span className="text-muted">
                Home Equity{" "}
                <HelpTip text="Home value minus mortgage balance -- the portion of your home you actually own" />
              </span>
              <span className="font-medium text-green-700">
                {formatCurrency(displayHomeValue - mortgageBalance)}
              </span>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
