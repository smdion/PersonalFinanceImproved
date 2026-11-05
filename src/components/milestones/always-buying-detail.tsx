"use client";

/**
 * Under "Always Be Buying": each SimpleFIN month (bought / no deposit /
 * not covered) and each losing year with the household's own
 * contributions against the year before.
 */
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { STATUS_COLORS } from "@/lib/utils/colors";
import { safeDivide } from "@/lib/utils/math";
import type {
  BuyingMonth,
  BuyingMonthState,
  DownYear,
} from "@/lib/pure/investments/always-buying";

const MONTH_STYLE: Record<BuyingMonthState, string> = {
  invested: `${STATUS_COLORS.green.bg} ${STATUS_COLORS.green.text}`,
  notInvested: `${STATUS_COLORS.amber.bg} ${STATUS_COLORS.amber.text}`,
  unknown: "bg-surface-elevated text-faint",
};
const MONTH_TITLE: Record<BuyingMonthState, string> = {
  invested: "a deposit",
  notInvested: "no deposit",
  unknown: "not covered by SimpleFIN",
};

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
}

export function AlwaysBuyingDetail({
  months,
  downYears,
}: {
  months: BuyingMonth[] | null;
  downYears: DownYear[];
}) {
  return (
    <div className="space-y-1.5">
      {months && months.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {months.map((m) => (
            <span
              key={m.month}
              title={`${m.month}: ${MONTH_TITLE[m.state]}`}
              className={`text-caption rounded px-1.5 py-0.5 ${MONTH_STYLE[m.state]}`}
            >
              {monthLabel(m.month)}
            </span>
          ))}
        </div>
      )}
      {downYears.length > 0 && (
        <ul className="text-muted space-y-0.5">
          {[...downYears].reverse().map((d) => (
            <li key={d.year}>
              {d.year}: investments {formatCurrency(d.gain, 0)}; you put in{" "}
              {formatCurrency(d.contributed, 0)} against{" "}
              {formatCurrency(d.prior, 0)} the year before
              {d.prior > 0 &&
                ` (${formatPercent(safeDivide(d.contributed, d.prior, 0), 0)})`}
              <span
                className={
                  d.heldUp ? STATUS_COLORS.green.text : STATUS_COLORS.amber.text
                }
              >
                {d.heldUp ? " — held up" : " — dropped"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
