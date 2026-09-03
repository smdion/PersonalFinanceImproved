/** Data-driven tooltip renderer with a fixed 17-section visual order — call sites supply a TooltipData shape and this module handles all layout, formatting, and recursive line-item rendering. */
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { taxTypeLabel } from "@/lib/utils/colors";
import { isRothType } from "@/lib/config/account-types";
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
    item.taxType != null && isRothType(item.taxType)
      ? " (Roth)"
      : item.taxType != null && !isRothType(item.taxType)
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
      <div className="flex items-baseline justify-between gap-3">
        <span className={`font-medium ${colorCls}`}>
          {item.label}
          {taxLabel}
        </span>
        <span className={`shrink-0 tabular-nums ${colorCls}`}>
          {prefixStr}
          {formatCurrency(item.amount)}
          {item.percent != null && (
            // item.percent is already on a 0-100 scale (not 0-1) — render directly, no *100.
            <span className={`${tipColorClass.gray} ml-1`}>
              ({item.percent}%)
            </span>
          )}
        </span>
      </div>
      {item.note && (
        <div
          className={`text-caption ${item.noteLocked ? tipColorClass.amber : tipColorClass.gray}`}
        >
          {item.noteLocked ? "⚠ " : "✓ "}
          {item.note}
        </div>
      )}
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
              <div
                // eslint-disable-next-line react/no-array-index-key -- tooltip lines have no stable ID
                key={`${i}-${l.text}`}
                className={`${tipColorClass.gray} text-caption`}
              >
                {l.text}
              </div>
            );
          const noteCls = l.color ? tipColorClass[l.color] : tipColorClass.gray;
          return (
            // eslint-disable-next-line react/no-array-index-key -- tooltip lines have no stable ID
            <div key={`${i}-${l.text}`} className={`text-caption ${noteCls}`}>
              {l.text}
            </div>
          );
        })}
      </div>
    );
  }

  const d = data;
  const growthColor =
    d.growth && d.growth.amount >= 0 ? tipColorClass.blue : tipColorClass.red;
  const growthPrefix = d.growth && d.growth.amount >= 0 ? "+" : "";

  return (
    <div className="space-y-0.5">
      {/* 1. HEADER */}
      <div className="font-medium">{d.header}</div>
      {/* 2. META */}
      {d.meta && (
        <div className={`${tipColorClass.gray} text-caption`}>{d.meta}</div>
      )}
      {/* 3. META2 */}
      {d.meta2 && (
        <div className={`${tipColorClass.gray} text-caption`}>{d.meta2}</div>
      )}
      {/* 3a. SHORTFALL (real, material unmet need — see types.ts docblock) */}
      {d.shortfall && (
        <div className="space-y-0.5">
          <div
            className={`flex justify-between gap-4 font-medium ${tipColorClass.red}`}
          >
            <span>⚠ Unmet need</span>
            <span className="tabular-nums">
              -{formatCurrency(d.shortfall.amount)}
            </span>
          </div>
          {(d.shortfall.nonRetirementAmount ?? 0) > 0 && (
            <div
              className={`flex justify-between gap-4 ${tipColorClass.red}/70 text-caption`}
            >
              <span>· excluding non-retirement (Portfolio) accounts</span>
              <span className="tabular-nums">
                -{formatCurrency(d.shortfall.nonRetirementAmount!)}
              </span>
            </div>
          )}
          {(d.shortfall.penaltyAvoidedAmount ?? 0) > 0 && (
            <div
              className={`flex justify-between gap-4 ${tipColorClass.red}/70 text-caption`}
            >
              <span>· excluding penalty-exposed money</span>
              <span className="tabular-nums">
                -{formatCurrency(d.shortfall.penaltyAvoidedAmount!)}
              </span>
            </div>
          )}
        </div>
      )}
      {/* 3b. RMD (table/chart parity — see types.ts docblock) */}
      {d.rmd && (
        <div className="space-y-0.5">
          <div
            className={`flex justify-between gap-4 font-medium ${d.rmd.shortfallAmount > 0 ? tipColorClass.red : tipColorClass.amber}`}
          >
            <span>{d.rmd.isStartYear ? "RMDs begin" : "RMD"}</span>
            <span className="tabular-nums">{formatCurrency(d.rmd.amount)}</span>
          </div>
          {d.rmd.shortfallAmount > 0 && (
            <div className={`${tipColorClass.red}/70 text-caption`}>
              Only {formatCurrency(d.rmd.amount - d.rmd.shortfallAmount)} of{" "}
              {formatCurrency(d.rmd.amount)} required met · 25% excise tax risk
            </div>
          )}
          {d.rmd.satisfiedNotably &&
            d.rmd.shortfallAmount <= 0 &&
            d.rmd.excessAmount <= 0 && (
              <div className={`${tipColorClass.amber}/70 text-caption`}>
                Met in full by your withdrawals.
              </div>
            )}
          {d.rmd.excessAmount > 0 && (
            <div
              className={`flex justify-between gap-4 ${tipColorClass.amber}/70 text-caption`}
            >
              <span>
                {d.rmd.excessMode === "spend"
                  ? "RMD excess spent"
                  : "RMD excess reinvested"}
              </span>
              <span className="tabular-nums">
                {d.rmd.excessMode === "spend" ? "" : "+"}
                {formatCurrency(d.rmd.excessAmount)}
              </span>
            </div>
          )}
          {(d.rmd.qcdAmount ?? 0) > 0 && (
            <div
              className={`flex justify-between gap-4 ${tipColorClass.violet}/70 text-caption`}
            >
              <span>QCD to charity</span>
              <span className="tabular-nums">
                {formatCurrency(d.rmd.qcdAmount!)}
              </span>
            </div>
          )}
          {d.rmd.divisorDetail && (
            <div className={`${tipColorClass.gray} text-caption`}>
              {d.rmd.divisorDetail}
            </div>
          )}
        </div>
      )}
      {/* 3c. STRATEGY EVENT (UI/UX review, 2026-08-28 — see types.ts docblock) */}
      {d.strategyEvent && (
        <div
          className="text-caption font-medium"
          style={{ color: d.strategyEvent.color }}
        >
          Strategy: {d.strategyEvent.text}
        </div>
      )}
      {/* 4. OVERRIDE NOTE */}
      {d.overrideNote && (
        <div className={`text-caption ${tipColorClass.emerald}`}>
          {d.overrideNote}
        </div>
      )}
      {/* 5. ITEMS */}
      {d.items && d.items.length > 0 && (
        <div className="space-y-1">
          {(() => {
            let lastGroup: string | undefined;
            return d.items.map((item, ii) => {
              const showGroup = !!item.group && item.group !== lastGroup;
              lastGroup = item.group;
              return (
                // eslint-disable-next-line react/no-array-index-key -- tooltip items have no stable ID
                <div key={`${ii}-${item.label}`}>
                  {showGroup && (
                    <div
                      className={`text-caption tracking-wide uppercase ${tipColorClass.gray} mt-1.5 first:mt-0`}
                    >
                      {item.group}
                    </div>
                  )}
                  {renderLineItem(item, ii)}
                </div>
              );
            });
          })()}
        </div>
      )}
      {/* 6. TOTAL */}
      {d.total && (
        <div className="border-t border-white/10 pt-1">
          <div className="font-medium">
            {d.total.label}:{" "}
            {d.total.prefix === "+" ? "+" : d.total.prefix === "-" ? "-" : ""}
            {formatCurrency(d.total.amount)}
          </div>
          {d.total.match != null && d.total.match > 0 && (
            <div className={`pl-2 ${tipColorClass.green}`}>
              + {formatCurrency(d.total.match)} {d.total.matchLabel ?? "match"}
            </div>
          )}
          {d.total.associatedMatch != null && d.total.associatedMatch > 0 && (
            <div className={`pl-2 ${tipColorClass.green}`}>
              + {formatCurrency(d.total.associatedMatch)}{" "}
              {d.total.matchLabel ?? "match"} (→ {taxTypeLabel("preTax")})
            </div>
          )}
        </div>
      )}
      {/* 7. TAX SPLIT */}
      {d.taxSplit && (d.taxSplit.traditional > 0 || d.taxSplit.roth > 0) && (
        <div
          className={`${tipColorClass.gray} text-caption border-t border-white/10 pt-1`}
        >
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
        <div
          className={`text-caption ${growthColor} ${d.items && d.items.length > 0 ? "border-t border-white/10 pt-1" : ""}`}
        >
          Growth: {growthPrefix}
          {formatCurrency(d.growth.amount)}
        </div>
      )}
      {/* 9. CONTRIBUTIONS */}
      {d.contributions && d.contributions.amount > 0 && (
        <div className={`text-caption ${tipColorClass.green}`}>
          Contributions: +{formatCurrency(d.contributions.amount)}
        </div>
      )}
      {/* 10. WITHDRAWALS */}
      {d.withdrawals && d.withdrawals.amount > 0 && (
        <div className={`text-caption ${tipColorClass.red}`}>
          Withdrawn: -{formatCurrency(d.withdrawals.amount)}
          {d.withdrawals.taxCost != null && d.withdrawals.taxCost > 0 && (
            <span> (~{formatCurrency(d.withdrawals.taxCost)} tax)</span>
          )}
        </div>
      )}
      {/* 11. YEAR CHANGE */}
      {d.yearChange && (
        <div className="text-label border-t border-white/10 pt-1 font-medium">
          Total: {formatCurrency(d.yearChange.total)} · Change:{" "}
          <span
            className={
              d.yearChange.change >= 0 ? tipColorClass.green : tipColorClass.red
            }
          >
            {d.yearChange.change >= 0 ? "+" : ""}
            {formatCurrency(d.yearChange.change)}
          </span>
          {d.yearChange.parts && d.yearChange.parts.length > 0 && (
            <span className={`${tipColorClass.gray} text-caption ml-1`}>
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
        <div className={`text-caption ${tipColorClass.amber}`}>
          Rate ceiling: {formatCurrency(d.rateCeiling.uncapped)} →{" "}
          {formatCurrency(d.rateCeiling.capped)} (
          {formatPercent(d.rateCeiling.pct, 1)} reduction)
        </div>
      )}
      {/* 13. ROUTING NOTE */}
      {d.routingNote && (
        <div className={`${tipColorClass.gray} text-caption`}>
          {d.routingNote}
        </div>
      )}
      {/* 14. BUDGET */}
      {d.budget && (
        <div
          className={`border-t border-white/10 pt-1 ${tipColorClass.gray} text-caption`}
        >
          Budget: {d.budget.profile} — {formatCurrency(d.budget.amount)}/yr
        </div>
      )}
      {/* 15. IRS LIMIT */}
      {d.irsLimit && (
        <div className={`${tipColorClass.gray} text-caption`}>
          {d.irsLimit.category} limit: {formatCurrency(d.irsLimit.used)} of{" "}
          {formatCurrency(d.irsLimit.limit)}
          {d.irsLimit.used >= d.irsLimit.limit && (
            <span className={`${tipColorClass.amber} ml-1`}>(maxed)</span>
          )}
        </div>
      )}
      {/* 16. PRO-RATE */}
      {d.proRate && (
        <div className={`${tipColorClass.gray} text-caption`}>
          Pro-rated: {d.proRate.months}/12 mo ·{" "}
          {formatCurrency(d.proRate.annualAmount)}/yr →{" "}
          {formatCurrency(d.proRate.proRatedAmount)}
        </div>
      )}
      {/* 16. BALANCE */}
      {d.balance != null && (
        <div className={`${tipColorClass.gray} text-caption`}>
          Balance: {formatCurrency(d.balance)}
        </div>
      )}
      {/* 17. LEGEND */}
      {d.legend && d.legend.length > 0 && (
        <div className={`${tipColorClass.gray} text-caption`}>
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
