"use client";

import React, { useState, memo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, Metric } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency } from "@/lib/utils/format";
import { LoadingCard, ErrorCard } from "./utils";

function NetWorthCardImpl() {
  const { data, isLoading, error } = trpc.networth.computeSummary.useQuery();
  const [useMarket, setUseMarket] = useState(true);
  if (isLoading) return <LoadingCard title="Net Worth" />;
  if (error) return <ErrorCard title="Net Worth" message="Failed to load" />;
  if (!data)
    return (
      <Card title="Net Worth" href="/networth">
        <p className="text-sm text-faint">
          Add a portfolio snapshot to start tracking net worth.
        </p>
      </Card>
    );

  const { result } = data;
  const displayNW = useMarket
    ? result.netWorthMarket
    : result.netWorthCostBasis;
  const homeValue = useMarket
    ? data.homeValueEstimated
    : data.homeValueConservative;

  return (
    <Card
      title={
        <>
          Net Worth
          <HelpTip text="Total assets (portfolio, home equity, cash) minus liabilities (mortgage). Toggle Market/Cost Basis to see unrealized gains." />
        </>
      }
      href="/networth"
    >
      <div className="flex items-center justify-between mb-1">
        <Metric value={formatCurrency(displayNW)} />
        <button
          onClick={(e) => {
            e.preventDefault();
            setUseMarket(!useMarket);
          }}
          className="text-xs bg-surface-elevated hover:bg-surface-strong rounded-full px-2 py-0.5 text-muted transition-colors"
        >
          {useMarket ? "Market" : "Cost Basis"}
        </button>
      </div>
      <div className="mt-2 space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-muted">All accounts</span>
          <span className="text-primary">
            {formatCurrency(data.portfolioTotal)}
          </span>
        </div>
        {data.hasHouse && (
          <div className="flex justify-between">
            <span className="text-muted">
              Home ({useMarket ? "est." : "cost"})
            </span>
            <span className="text-primary">{formatCurrency(homeValue)}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-muted">Cash</span>
          <span className="text-primary">{formatCurrency(data.cash)}</span>
        </div>
        {data.otherAssetItems &&
          data.otherAssetItems.length > 0 &&
          data.otherAssetItems.map((item) => (
            <div key={item.name} className="flex justify-between">
              <span className="text-muted">{item.name}</span>
              <span className="text-primary">{formatCurrency(item.value)}</span>
            </div>
          ))}
        {data.hasHouse && (
          <div className="flex justify-between">
            <span className="text-muted">Mortgage</span>
            <span className="text-red-600">
              -{formatCurrency(data.mortgageBalance)}
            </span>
          </div>
        )}
      </div>
      {/* Data freshness dates moved to sidebar global indicator */}
    </Card>
  );
}

export const NetWorthCard = memo(NetWorthCardImpl);
