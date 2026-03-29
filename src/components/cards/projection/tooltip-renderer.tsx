/** Data-driven tooltip renderer with a fixed 17-section visual order — call sites supply a TooltipData shape and this module handles all layout, formatting, and recursive line-item rendering. */
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { taxTypeLabel } from "@/lib/utils/colors";
import type { TooltipLineItem, TooltipData } from "./types";
import { tipColorClass } from "./utils";

/**
 * Renders a single tooltip line item (contribution, withdrawal, balance, etc.).
 * Recursive: renders child items (match, sub-items) as nested rows.
 */
export function renderLineItem(
  item: TooltipLineItem,
  idx: number,
  nested = false,
): React.ReactNode {
  const colorCls = item.color ? tipColorClass[item.color] : "";
  const prefixStr = item.prefix === "+" ? "+" : item.prefix === "-" ? "-" : "";
  const taxLabel =
    item.taxType === "roth"
      ? " (Roth)"
      : item.taxType === "traditional"
        ? " (Trad)"
        : "";
  // Collect all supplementary details as sub-items (match, associatedMatch, explicit sub[])
  const allSub: TooltipLineItem[] = [];
  if (item.match != null && item.match > 0)
    allSub.push({
      label: item.matchLabel ?? "match",
      amount: item.match,
      prefix: "+",
      color: "green",
    });
  if (item.associatedMatch != null && item.associatedMatch > 0)
    allSub.push({
      label: `${item.matchLabel ?? "match"} (→ ${taxTypeLabel("preTax")})`,
      amount: item.associatedMatch,
      prefix: "+",
      color: "green",
    });
  if (item.sub) allSub.push(...item.sub);
  return (
    <div key={idx} className={nested ? "pl-2" : ""}>
      <div>
        <span className={`font-medium ${colorCls}`}>
          {item.label}
          {taxLabel}
        </span>
        {":"}
        <span className={colorCls}>
          {prefixStr}
          {formatCurrency(item.amount)}
        </span>
        {item.pct != null && (
          <span className="text-faint ml-1">({item.pct}%)</span>
        )}
      </div>
      {allSub.length > 0 && (
        <div className="space-y-0.5">
          {allSub.map((child, ci) => renderLineItem(child, ci, true))}
        </div>
      )}
    </div>
  );
}

/**
 * Data-driven tooltip renderer — fixed visual order, call sites provide data only.
 * Renders 17 sections in a consistent order: header, meta, override note, items,
 * total, tax split, growth, contributions, withdrawals, year change, rate ceiling,
 * routing note, budget, IRS limit, pro-rate, balance, legend.
 */
export function renderTooltip(data: TooltipData): React.ReactNode {
  if (data.kind === "info") {
    return (
      <div className="space-y-0.5">
        {data.lines.map((l, i) => {
          if (l.style === "header")
            return (
              // eslint-disable-next-line react/no-array-index-key -- tooltip lines have no stable ID
              <div key={`${i}-${l.text}`} className="font-medium">
                {l.text}
              </div>
            );
          if (l.style === "meta")
            return (
              // eslint-disable-next-line react/no-array-index-key -- tooltip lines have no stable ID
              <div key={`${i}-${l.text}`} className="text-faint text-[10px]">
                {l.text}
              </div>
            );
          const noteCls = l.color ? tipColorClass[l.color] : "text-faint";
          return (
            // eslint-disable-next-line react/no-array-index-key -- tooltip lines have no stable ID
            <div key={`${i}-${l.text}`} className={`text-[10px] ${noteCls}`}>
              {l.text}
            </div>
          );
        })}
      </div>
    );
  }

  const d = data;
  const growthColor =
    d.growth && d.growth.amount >= 0 ? "text-blue-300" : "text-red-300";
  const growthPrefix = d.growth && d.growth.amount >= 0 ? "+" : "";

  return (
    <div className="space-y-0.5">
      {/* 1. HEADER */}
      <div className="font-medium">{d.header}</div>
      {/* 2. META */}
      {d.meta && <div className="text-faint text-[10px]">{d.meta}</div>}
      {/* 3. META2 */}
      {d.meta2 && <div className="text-faint text-[10px]">{d.meta2}</div>}
      {/* 4. OVERRIDE NOTE */}
      {d.overrideNote && (
        <div className="text-[10px] text-emerald-300">{d.overrideNote}</div>
      )}
      {/* 5. ITEMS */}
      {d.items && d.items.length > 0 && (
        <div className="space-y-0.5">
          {d.items.map((item, ii) => renderLineItem(item, ii))}
        </div>
      )}
      {/* 6. TOTAL */}
      {d.total && (
        <div className="border-t pt-1">
          <div className="font-medium">
            {d.total.label}:{" "}
            {d.total.prefix === "+" ? "+" : d.total.prefix === "-" ? "-" : ""}
            {formatCurrency(d.total.amount)}
          </div>
          {d.total.match != null && d.total.match > 0 && (
            <div className="pl-2 text-green-400">
              + {formatCurrency(d.total.match)} {d.total.matchLabel ?? "match"}
            </div>
          )}
          {d.total.associatedMatch != null && d.total.associatedMatch > 0 && (
            <div className="pl-2 text-green-400">
              + {formatCurrency(d.total.associatedMatch)}{" "}
              {d.total.matchLabel ?? "match"} (→ {taxTypeLabel("preTax")})
            </div>
          )}
        </div>
      )}
      {/* 7. TAX SPLIT */}
      {d.taxSplit && (d.taxSplit.traditional > 0 || d.taxSplit.roth > 0) && (
        <div className="text-faint text-[10px] border-t pt-1">
          {d.taxSplit.traditional > 0 && (
            <span>Trad: {formatCurrency(d.taxSplit.traditional)}</span>
          )}
          {d.taxSplit.traditional > 0 && d.taxSplit.roth > 0 && (
            <span> · </span>
          )}
          {d.taxSplit.roth > 0 && (
            <span>Roth: {formatCurrency(d.taxSplit.roth)}</span>
          )}
        </div>
      )}
      {/* 8. GROWTH */}
      {d.growth && Math.abs(d.growth.amount) > 1 && (
        <div className={`text-[10px] ${growthColor}`}>
          Growth: {growthPrefix}
          {formatCurrency(d.growth.amount)}
        </div>
      )}
      {/* 9. CONTRIBUTIONS */}
      {d.contributions && d.contributions.amount > 0 && (
        <div className="text-[10px] text-green-400">
          Contributions: +{formatCurrency(d.contributions.amount)}
        </div>
      )}
      {/* 10. WITHDRAWALS */}
      {d.withdrawals && d.withdrawals.amount > 0 && (
        <div className="text-[10px] text-red-300">
          Withdrawn: -{formatCurrency(d.withdrawals.amount)}
          {d.withdrawals.taxCost != null && d.withdrawals.taxCost > 0 && (
            <span> (~{formatCurrency(d.withdrawals.taxCost)} tax)</span>
          )}
        </div>
      )}
      {/* 11. YEAR CHANGE */}
      {d.yearChange && (
        <div className="border-t pt-1 text-[11px] font-medium">
          Total: {formatCurrency(d.yearChange.total)} · Change:{" "}
          <span
            className={
              d.yearChange.change >= 0 ? "text-green-300" : "text-red-300"
            }
          >
            {d.yearChange.change >= 0 ? "+" : ""}
            {formatCurrency(d.yearChange.change)}
          </span>
          {d.yearChange.parts && d.yearChange.parts.length > 0 && (
            <span className="text-muted text-[10px] ml-1">
              (
              {d.yearChange.parts.map((p, i) => (
                <span key={p.label}>
                  {i > 0 && " ·"}
                  <span className={tipColorClass[p.color]}>
                    {p.amount >= 0 ? "+" : ""}
                    {formatCurrency(p.amount)} {p.label}
                  </span>
                </span>
              ))}
              )
            </span>
          )}
        </div>
      )}
      {/* 12. RATE CEILING */}
      {d.rateCeiling && (
        <div className="text-[10px] text-amber-300">
          Rate ceiling: {formatCurrency(d.rateCeiling.uncapped)} →{" "}
          {formatCurrency(d.rateCeiling.capped)} (
          {formatPercent(d.rateCeiling.pct, 1)} reduction)
        </div>
      )}
      {/* 13. ROUTING NOTE */}
      {d.routingNote && (
        <div className="text-faint text-[10px]">{d.routingNote}</div>
      )}
      {/* 14. BUDGET */}
      {d.budget && (
        <div className="border-t pt-1 text-faint text-[10px]">
          Budget: {d.budget.profile} — {formatCurrency(d.budget.amount)}/yr
        </div>
      )}
      {/* 15. IRS LIMIT */}
      {d.irsLimit && (
        <div className="text-faint text-[10px]">
          {d.irsLimit.category} limit: {formatCurrency(d.irsLimit.used)} of{" "}
          {formatCurrency(d.irsLimit.limit)}
          {d.irsLimit.used >= d.irsLimit.limit && (
            <span className="text-amber-300 ml-1">(maxed)</span>
          )}
        </div>
      )}
      {/* 16. PRO-RATE */}
      {d.proRate && (
        <div className="text-faint text-[10px]">
          Pro-rated: {d.proRate.months}/12 mo ·{" "}
          {formatCurrency(d.proRate.annualAmount)}/yr →{" "}
          {formatCurrency(d.proRate.proRatedAmount)}
        </div>
      )}
      {/* 16. BALANCE */}
      {d.balance != null && (
        <div className="text-faint text-[10px]">
          Balance: {formatCurrency(d.balance)}
        </div>
      )}
      {/* 17. LEGEND */}
      {d.legend && d.legend.length > 0 && (
        <div className="text-muted text-[10px]">
          {d.legend.map((e, ei) => (
            <span key={e.label}>
              {ei > 0 && " ·"}
              <span className={tipColorClass[e.color]}>{e.label}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
