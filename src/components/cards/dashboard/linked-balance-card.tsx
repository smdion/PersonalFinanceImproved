"use client";

import React, { memo } from "react";
import {
  LineChart,
  Line,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "recharts";
import { trpc } from "@/lib/trpc";
import { Card, Metric } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency } from "@/lib/utils/format";
import { CHART_COLORS } from "@/lib/utils/colors";
import { chartMargin, CHART_FONT } from "@/components/charts/chart-defaults";
import { LoadingCard } from "./utils";

const SPARKLINE_DAYS = 30;

function LinkedBalanceCardImpl() {
  const { data: status, isLoading: statusLoading } =
    trpc.simplefin.getStatus.useQuery();
  const isConnected = status?.connected ?? false;

  const { data: history, isLoading: historyLoading } =
    trpc.simplefin.listBalanceHistory.useQuery(
      { days: SPARKLINE_DAYS },
      { enabled: isConnected },
    );

  if (statusLoading) return <LoadingCard title="Linked Balance" />;
  // No SimpleFIN connection configured — omit the card entirely rather
  // than showing an empty/setup-nag widget. Setup lives in Settings.
  if (!isConnected) return null;
  if (historyLoading) return <LoadingCard title="Linked Balance" />;
  if (!history || history.length === 0) {
    return (
      <Card title="Linked Balance" href="/settings">
        <p className="text-sm text-faint">
          Connected — the first daily balance will appear after the next sync.
        </p>
      </Card>
    );
  }

  const latest = history[history.length - 1];
  const previous = history.length > 1 ? history[history.length - 2] : null;
  if (!latest) return null;
  const delta = previous ? latest.totalBalance - previous.totalBalance : null;

  return (
    <Card
      title={
        <>
          Linked Balance
          <HelpTip text="Daily total of accounts linked via SimpleFIN Bridge. Updates once a day and is separate from the manually-curated Net Worth figure above." />
        </>
      }
      href="/settings"
    >
      <Metric
        value={formatCurrency(latest.totalBalance)}
        trend={
          delta !== null && delta !== 0
            ? {
                positive: delta > 0,
                value: formatCurrency(Math.abs(delta)),
              }
            : undefined
        }
      />
      <div className="h-12 mt-2 -mx-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={history} margin={chartMargin}>
            <RechartsTooltip
              labelFormatter={(label) => String(label)}
              formatter={(value) => [formatCurrency(Number(value)), "Balance"]}
              contentStyle={{ fontSize: CHART_FONT.tooltip }}
            />
            <Line
              type="monotone"
              dataKey="totalBalance"
              stroke={CHART_COLORS.linkedBalance}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="text-caption text-faint mt-1">
        {status?.lastSyncedAt
          ? `Updated ${new Date(status.lastSyncedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
          : "Not yet synced"}
        {" · "}
        {latest.accountCount} account{latest.accountCount === 1 ? "" : "s"}
      </p>
    </Card>
  );
}

export const LinkedBalanceCard = memo(LinkedBalanceCardImpl);
