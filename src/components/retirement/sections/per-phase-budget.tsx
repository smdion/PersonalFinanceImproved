/**
 * Per-phase budget profile + column selection.
 *
 * This is the middle child block of Retirement budget and strategy: it
 * renders the decumulation-phase Budget Source picker (profile dropdown +
 * column picker or weighted summary) alongside the Salary Override inline
 * edit. Returns null if there are no budget profiles at all.
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
import { STRATEGY_CONFIG_BY_STORED_KEY } from "@/lib/config/stored-withdrawal-strategy";
import { formatCurrency } from "@/lib/utils/format";
import type { Settings, BudgetProfileSummaries, IsEditable } from "./types";

type Props = {
  settings: Settings;
  budgetProfileSummaries: BudgetProfileSummaries;
  decumulationBudgetProfileId: number | null | undefined;
  decumulationBudgetColumn: number;
  decumulationExpenseOverride: string | null;
  setDecumulationExpenseOverride: (v: string | null) => void;
  setDecumulationBudgetProfileId: (id: number | null) => void;
  setDecumulationBudgetCol: (col: number | null) => void;
  isEditable: IsEditable;
};

export function PerPhaseBudgetSection({
  settings,
  budgetProfileSummaries,
  decumulationBudgetProfileId,
  decumulationBudgetColumn,
  decumulationExpenseOverride,
  setDecumulationExpenseOverride,
  setDecumulationBudgetProfileId,
  setDecumulationBudgetCol,
  isEditable,
}: Props) {
  const meta = STRATEGY_CONFIG_BY_STORED_KEY[settings.withdrawalStrategy];
  if (!meta) return null;
  const { incomeSource } = meta;
  const { usesWithdrawalRate, usesPostRetirementRaise } = meta;
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
  const profiles = budgetProfileSummaries;
  if (profiles.length === 0) return null;

  const decumulationProfile =
    profiles.find((p) => p.id === decumulationBudgetProfileId) ??
    profiles.find((p) => p.isActive);
  const decumulationLabels = decumulationProfile?.columnLabels ?? [];
  const decumulationTotals = decumulationProfile?.columnTotals ?? [];
  const decumulationMonths =
    (decumulationProfile?.columnMonths as number[] | null) ?? null;
  const decumulationWeighted =
    (decumulationProfile?.weightedAnnualTotal as number | null) ?? null;

  return (
    <div>
      {(budgetNotUsed || !usesPostRetirementRaise) && (
        <div className="mb-2 rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-600">
          {`${meta.label} computes spending from ${
            incomeSource === "formula"
              ? "your portfolio balance using IRS/endowment formulas"
              : usesWithdrawalRate
                ? "your retirement budget"
                : "a strategy-specific portfolio percentage"
          }.`}
          {dimmedSettingsNote(
            budgetNotUsed,
            usesWithdrawalRate,
            usesPostRetirementRaise,
          )}
        </div>
      )}
      <div
        className={`grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2 ${budgetNotUsed ? "opacity-40" : ""}`}
      >
        {/* Retirement Budget source */}
        <div>
          <span className="text-muted">
            Budget Source
            <HelpTip text={budgetTip(meta, "source")} />
          </span>
          <div className="flex flex-col gap-1 font-medium">
            {decumulationExpenseOverride ? (
              <span className="text-faint text-xs italic">
                Using the amount you set
              </span>
            ) : (
              <>
                <select
                  className="bg-surface-primary rounded border px-2 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  value={decumulationBudgetProfileId ?? ""}
                  disabled={!isEditable || budgetNotUsed}
                  onChange={(e) => {
                    setDecumulationBudgetProfileId(
                      e.target.value ? Number(e.target.value) : null,
                    );
                    setDecumulationBudgetCol(null);
                  }}
                >
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.isActive ? " (active)" : ""}
                    </option>
                  ))}
                </select>
                {decumulationMonths ? (
                  <Badge color="amber" size="sm" case="normal">
                    Weighted: {formatCurrency(decumulationWeighted ?? 0)}
                    /yr
                    <span className="text-caption text-faint ml-1">
                      (
                      {decumulationMonths
                        .map((m, i) => `${m}mo ${decumulationLabels[i] ?? ""}`)
                        .join(" +")}
                      )
                    </span>
                  </Badge>
                ) : decumulationLabels.length >= 2 ? (
                  <select
                    className="bg-surface-primary rounded border px-2 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                    value={decumulationBudgetColumn}
                    disabled={!isEditable || budgetNotUsed}
                    onChange={(e) =>
                      setDecumulationBudgetCol(Number(e.target.value))
                    }
                  >
                    {decumulationLabels.map((label: string, index: number) => (
                      <option key={label} value={index}>
                        {label} (
                        {formatCurrency((decumulationTotals[index] ?? 0) * 12)}
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
            Set amount
            <HelpTip text={budgetTip(meta, "amount")} />
          </span>
          <div className="flex items-center gap-1 font-medium">
            <InlineEdit
              value={decumulationExpenseOverride ?? ""}
              onSave={(v) => {
                const cleaned = v.replace(/[^0-9]/g, "");
                setDecumulationExpenseOverride(cleaned || null);
              }}
              formatDisplay={(v) =>
                v ? `${formatCurrency(Number(v))}/yr` : "None (using budget)"
              }
              parseInput={(v) => v.replace(/[^0-9]/g, "")}
              type="number"
              className="text-sm"
              isEditable={isEditable && !budgetNotUsed}
            />
            {decumulationExpenseOverride && (
              <button
                disabled={!isEditable}
                className="text-caption text-red-400 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => setDecumulationExpenseOverride(null)}
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

/** Names the settings this strategy doesn't use. */
function dimmedSettingsNote(
  budgetNotUsed: boolean,
  usesWithdrawalRate: boolean,
  usesPostRetirementRaise: boolean,
) {
  const dimmed: string[] = [];
  if (budgetNotUsed) dimmed.push("budget source");
  if (!usesWithdrawalRate) dimmed.push("initial withdrawal rate");
  if (!usesPostRetirementRaise) dimmed.push("post-retirement raise");
  return dimmed.length > 0
    ? ` Dimmed settings (${dimmed.join(", ")}) are not used by this strategy.`
    : "";
}

/** The Budget Source and Set amount tips: what the budget is, and what the
 *  chosen strategy does with it (config flags, not strategy names). */
function budgetTip(
  meta: {
    label: string;
    usesWithdrawalRate: boolean;
    usesPostRetirementRaise: boolean;
  },
  field: "source" | "amount",
): string {
  const use = !meta.usesWithdrawalRate
    ? `${meta.label} sizes its withdrawals from your balance; this is the need its spending is checked against.`
    : meta.usesPostRetirementRaise
      ? "Grows by the Post-Retirement Raise."
      : "Grows with inflation less the strategy's decline rate.";
  return field === "source"
    ? `What you need each year in retirement, Social Security included. ${use} Set an amount yourself or use a budget profile.`
    : `Set a flat yearly amount as your Retirement budget, used instead of the budget profile. ${use}`;
}
