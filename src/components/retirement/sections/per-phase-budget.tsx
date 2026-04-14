/**
 * Per-phase budget profile + column selection — extracted from the
 * Decumulation Plan block in retirement-content.tsx in PR 8/3b of the v0.5.2
 * file-split refactor. Pure relocation — no behavior changes.
 *
 * This is the middle child block of Decumulation Plan: it renders the
 * decumulation-phase Budget Source picker (profile dropdown + column picker
 * or weighted summary) alongside the Salary Override inline edit. Returns
 * null if there are no budget profiles at all, matching the IIFE guard.
 *
 * The block also shows an amber "strategy X computes spending from ..."
 * banner when the active withdrawal strategy doesn't consume the budget /
 * withdrawal rate / post-retirement raise.
 */
"use client";

import { HelpTip } from "@/components/ui/help-tip";
import { InlineEdit } from "@/components/ui/inline-edit";
import {
  getStrategyMeta,
  type WithdrawalStrategyType,
} from "@/lib/config/withdrawal-strategies";
import { formatCurrency } from "@/lib/utils/format";
import type { Settings, BudgetProfileSummaries } from "./_types";

type Props = {
  settings: Settings;
  budgetProfileSummaries: BudgetProfileSummaries;
  decumulationBudgetProfileId: number | null | undefined;
  decumulationBudgetColumn: number;
  decExpenseOverride: string | null;
  setDecExpenseOverride: (v: string | null) => void;
  setDecBudgetProfileId: (id: number | null) => void;
  setDecBudgetCol: (col: number | null) => void;
};

export function PerPhaseBudgetSection({
  settings,
  budgetProfileSummaries,
  decumulationBudgetProfileId,
  decumulationBudgetColumn,
  decExpenseOverride,
  setDecExpenseOverride,
  setDecBudgetProfileId,
  setDecBudgetCol,
}: Props) {
  const activeStrategy = (settings?.withdrawalStrategy ??
    "fixed") as WithdrawalStrategyType;
  const strategyMeta = getStrategyMeta(activeStrategy);
  const { incomeSource } = strategyMeta;
  const budgetNotUsed = incomeSource === "formula" || incomeSource === "rate";
  const { usesWithdrawalRate, usesPostRetirementRaise } = strategyMeta;
  const profiles = budgetProfileSummaries ?? [];
  if (profiles.length === 0) return null;

  const decProfile =
    profiles.find((p) => p.id === decumulationBudgetProfileId) ??
    profiles.find((p) => p.isActive);
  const decLabels = decProfile?.columnLabels ?? [];
  const decTotals = decProfile?.columnTotals ?? [];
  const decMonths = (decProfile?.columnMonths as number[] | null) ?? null;
  const decWeighted =
    (decProfile?.weightedAnnualTotal as number | null) ?? null;

  return (
    <div>
      {(budgetNotUsed || !usesWithdrawalRate || !usesPostRetirementRaise) && (
        <div className="text-xs text-amber-600 bg-amber-50 rounded px-2 py-1.5 mb-2">
          {`${strategyMeta.label} computes spending from ${
            incomeSource === "formula"
              ? "your portfolio balance using IRS/endowment formulas"
              : incomeSource === "rate"
                ? "withdrawal rate × portfolio"
                : "your retirement budget"
          }.`}
          {(() => {
            const dimmed: string[] = [];
            if (budgetNotUsed) dimmed.push("budget source");
            if (!usesWithdrawalRate) dimmed.push("initial withdrawal rate");
            if (!usesPostRetirementRaise) dimmed.push("post-retirement raise");
            return dimmed.length > 0
              ? ` Dimmed settings (${dimmed.join(", ")}) are not used by this strategy.`
              : "";
          })()}
        </div>
      )}
      <div
        className={`grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm ${budgetNotUsed ? "opacity-40" : ""}`}
      >
        {/* Retirement Budget source */}
        <div>
          <span className="text-muted">
            Budget Source
            <HelpTip text="Your starting retirement 'salary' — what you pay yourself from your portfolio each year. Grows by the Post-Retirement Raise rate. Set a manual override or use a budget profile." />
          </span>
          <div className="font-medium flex flex-col gap-1">
            {decExpenseOverride ? (
              <span className="text-faint text-xs italic">
                Using manual override
              </span>
            ) : (
              <>
                <select
                  className="text-sm border rounded px-2 py-1 bg-surface-primary"
                  value={decumulationBudgetProfileId ?? ""}
                  onChange={(e) => {
                    setDecBudgetProfileId(
                      e.target.value ? Number(e.target.value) : null,
                    );
                    setDecBudgetCol(null);
                  }}
                >
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.isActive ? " (active)" : ""}
                    </option>
                  ))}
                </select>
                {decMonths ? (
                  <span className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">
                    Weighted: {formatCurrency(decWeighted ?? 0)}
                    /yr
                    <span className="text-[10px] text-faint ml-1">
                      (
                      {decMonths
                        .map((m, i) => `${m}mo ${decLabels[i] ?? ""}`)
                        .join(" +")}
                      )
                    </span>
                  </span>
                ) : decLabels.length >= 2 ? (
                  <select
                    className="text-sm border rounded px-2 py-1 bg-surface-primary"
                    value={decumulationBudgetColumn}
                    onChange={(e) => setDecBudgetCol(Number(e.target.value))}
                  >
                    {decLabels.map((label: string, idx: number) => (
                      <option key={label} value={idx}>
                        {label} ({formatCurrency((decTotals[idx] ?? 0) * 12)}
                        /yr)
                      </option>
                    ))}
                  </select>
                ) : null}
              </>
            )}
          </div>
        </div>
        {/* Retirement salary override */}
        <div>
          <span className="text-muted">
            Salary Override
            <HelpTip text="Set a flat annual amount as your starting retirement salary. Overrides the budget profile. Grows by the Post-Retirement Raise rate each year." />
          </span>
          <div className="font-medium flex items-center gap-1">
            <InlineEdit
              value={decExpenseOverride ?? ""}
              onSave={(v) => {
                const cleaned = v.replace(/[^0-9]/g, "");
                setDecExpenseOverride(cleaned || null);
              }}
              formatDisplay={(v) =>
                v ? `${formatCurrency(Number(v))}/yr` : "None (using budget)"
              }
              parseInput={(v) => v.replace(/[^0-9]/g, "")}
              type="number"
              className="text-sm"
              editable={!!settings}
            />
            {decExpenseOverride && (
              <button
                className="text-[10px] text-red-400 hover:text-red-600"
                onClick={() => setDecExpenseOverride(null)}
              >
                clear
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
