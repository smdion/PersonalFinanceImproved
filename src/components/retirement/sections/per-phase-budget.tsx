/**
 * Per-phase budget profile + column selection.
 *
 * This is the middle child block of Decumulation Plan: it renders the
 * decumulation-phase Budget Source picker (profile dropdown + column picker
 * or weighted summary) alongside the Salary Override inline edit. Returns
 * null if there are no budget profiles at all, matching the IIFE guard.
 *
 * The block also shows an amber "strategy X computes spending from ..."
 * banner when the active withdrawal strategy doesn't consume the budget /
 * withdrawal rate / post-retirement raise — and also
 * disables the budget-source select/column select/salary-override edit in
 * that case too (previously only dimmed via opacity, still fully editable
 * underneath — same class of bug as raise-and-rate.tsx's two fields, found
 * alongside it). This component also had no `isEditable`/admin gating at
 * all until the same pass — every other section in this tab disables for
 * non-admins; this one let a non-admin interact freely and only failed
 * silently at the (adminProcedure-gated) mutation layer.
 */
"use client";

import { HelpTip } from "@/components/ui/help-tip";
import { InlineEdit } from "@/components/ui/inline-edit";
import { Badge } from "@/components/ui/badge";
import {
  getStrategyMeta,
  type WithdrawalStrategyType,
} from "@/lib/config/withdrawal-strategies";
import { formatCurrency } from "@/lib/utils/format";
import type { Settings, BudgetProfileSummaries, IsEditable } from "./types";

type Props = {
  settings: Settings;
  budgetProfileSummaries: BudgetProfileSummaries;
  decumulationBudgetProfileId: number | null | undefined;
  decumulationBudgetColumn: number;
  decExpenseOverride: string | null;
  setDecExpenseOverride: (v: string | null) => void;
  setDecBudgetProfileId: (id: number | null) => void;
  setDecBudgetCol: (col: number | null) => void;
  isEditable: IsEditable;
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
  isEditable,
}: Props) {
  const activeStrategy = (settings?.withdrawalStrategy ??
    "fixed") as WithdrawalStrategyType;
  const strategyMeta = getStrategyMeta(activeStrategy);
  const { incomeSource } = strategyMeta;
  const { usesWithdrawalRate, usesPostRetirementRaise } = strategyMeta;
  // Branch on usesWithdrawalRate, not incomeSource -- incomeSource labels
  // Guyton-Klinger "rate" (a UI-framing distinction), but GK's actual
  // year-1 spending IS budget-seeded (initialWithdrawalRate is DERIVED
  // FROM the budget, not an independent setting) and every subsequent
  // year is a guardrail adjustment of that, same as Fixed/Forgo/Spending
  // Decline. usesWithdrawalRate already correctly separates the 4
  // genuinely budget-seeded strategies from the 4 that aren't (RMD-based,
  // Constant %, Endowment, Vanguard Dynamic) -- same fix already applied
  // in mc-simulation-assumptions.tsx for this exact distinction.
  const budgetNotUsed = !usesWithdrawalRate;
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
      {(budgetNotUsed || !usesPostRetirementRaise) && (
        <div className="mb-2 rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-600">
          {`${strategyMeta.label} computes spending from ${
            incomeSource === "formula"
              ? "your portfolio balance using IRS/endowment formulas"
              : usesWithdrawalRate
                ? "your retirement budget"
                : "a strategy-specific portfolio percentage"
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
        className={`grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2 ${budgetNotUsed ? "opacity-40" : ""}`}
      >
        {/* Retirement Budget source */}
        <div>
          <span className="text-muted">
            Budget Source
            <HelpTip text="Your starting retirement 'salary' — what you pay yourself from your portfolio each year. Grows by the Post-Retirement Raise rate. Set a manual override or use a budget profile." />
          </span>
          <div className="flex flex-col gap-1 font-medium">
            {decExpenseOverride ? (
              <span className="text-faint text-xs italic">
                Using manual override
              </span>
            ) : (
              <>
                <select
                  className="bg-surface-primary rounded border px-2 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  value={decumulationBudgetProfileId ?? ""}
                  disabled={!isEditable || budgetNotUsed}
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
                  <Badge color="amber" size="sm" case="normal">
                    Weighted: {formatCurrency(decWeighted ?? 0)}
                    /yr
                    <span className="text-caption text-faint ml-1">
                      (
                      {decMonths
                        .map((m, i) => `${m}mo ${decLabels[i] ?? ""}`)
                        .join(" +")}
                      )
                    </span>
                  </Badge>
                ) : decLabels.length >= 2 ? (
                  <select
                    className="bg-surface-primary rounded border px-2 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                    value={decumulationBudgetColumn}
                    disabled={!isEditable || budgetNotUsed}
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
          <div className="flex items-center gap-1 font-medium">
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
              isEditable={isEditable && !!settings && !budgetNotUsed}
            />
            {decExpenseOverride && (
              <button
                disabled={!isEditable}
                className="text-caption text-red-400 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
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
