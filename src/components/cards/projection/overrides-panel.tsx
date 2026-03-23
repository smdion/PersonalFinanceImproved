"use client";

import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { taxTypeLabel, accountTextColor } from "@/lib/utils/colors";
import {
  getAccountTypeConfig,
  categoriesWithTaxPreference,
  getLimitGroup,
} from "@/lib/config/account-types";
import { ALL_CATEGORIES, catDisplayLabel } from "./utils";
import type { useProjectionState } from "./use-projection-state";

function SectionHeader({
  title,
  help,
  children,
}: {
  title: string;
  help?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-2">
      <h4 className="text-xs font-medium text-muted uppercase tracking-wide">
        {title}
        {help && <HelpTip text={help} />}
      </h4>
      {children}
    </div>
  );
}

type ProjectionState = ReturnType<typeof useProjectionState>;

export type OverridesPanelProps = {
  state: ProjectionState;
  accumulationExpenseOverride?: number;
};

/**
 * Unified overrides panel — saving, withdrawal, salary, and budget overrides.
 * Extracted from ProjectionCard to reduce file size.
 */
export function OverridesPanel({ state: s, accumulationExpenseOverride }: OverridesPanelProps) {
  const {
    accumOverrides, setAccumOverrides,
    decumOverrides, setDecumOverrides,
    showAccumForm, setShowAccumForm,
    accumForm, setAccumForm,
    showDecumForm, setShowDecumForm,
    decumForm, setDecumForm,
    showSalaryForm, setShowSalaryForm,
    salaryForm, setSalaryForm,
    showBudgetForm, setShowBudgetForm,
    budgetForm, setBudgetForm,
    showLifeOverrides, setShowLifeOverrides,
    personFilter, isPersonFiltered, personFilterName,
    dbSalaryOverrides, dbBudgetOverrides,
    salaryByPerson, budgetProfileSummaries,
    enginePeople, primaryPersonId, salaryOverridePersonId,
    combinedSalary, annualExpenses,
    rothBracketPresets,
    handleAddAccumOverride, handleAddDecumOverride,
    createSalaryOverride, deleteSalaryOverride,
    createBudgetOverride, deleteBudgetOverride,
  } = s;

  return (
          <div className="border rounded-lg p-4 space-y-3">
            <SectionHeader
              title="Overrides"
              help="Change contribution, withdrawal, salary, or budget settings at specific future years. Each override carries forward (sticky) until the next override for that field. Use 'Reset to defaults' to revert all fields at once."
            />

            {/* Summary counts */}
            <div className="flex flex-wrap gap-3 text-xs text-muted">
              <span>
                <span className="font-medium text-emerald-700">
                  {accumOverrides.length}
                </span>
                {""}
                saving
              </span>
              <span>
                <span className="font-medium text-amber-700">
                  {decumOverrides.length}
                </span>
                {""}
                withdrawal
              </span>
              <span>
                <span className="font-medium text-secondary">
                  {(dbSalaryOverrides?.length ?? 0) +
                    (dbBudgetOverrides?.length ?? 0)}
                </span>
                {""}
                life change
              </span>
            </div>

            {/* --- SAVING OVERRIDES --- */}
            <div className="border-t border-subtle pt-3">
              <div className="flex items-center justify-between mb-2">
                <h5 className="text-[11px] font-medium text-muted uppercase tracking-wide">
                  Saving
                  <HelpTip text="Change contribution rate, routing mode, account order, tax splits, or caps at a specific future year. Changes carry forward until the next override." />
                </h5>
                <button
                  type="button"
                  onClick={() => setShowAccumForm(!showAccumForm)}
                  className="text-[11px] text-emerald-600 hover:underline"
                >
                  {showAccumForm ? "Cancel" : "+ Add"}
                </button>
              </div>

              {/* Existing overrides */}
              {accumOverrides.length > 0 && (
                <div className="space-y-1 mb-2">
                  {accumOverrides.map((o, i) => (
                    <div
                      key={o.year}
                      className="flex items-center justify-between bg-emerald-50 rounded px-3 py-1.5 text-xs"
                    >
                      <div className="flex flex-wrap gap-2 items-center">
                        <span className="font-semibold text-emerald-800">
                          {o.year}+
                        </span>
                        {o.personName && (
                          <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">
                            {o.personName}
                          </span>
                        )}
                        {!o.personName &&
                          enginePeople &&
                          enginePeople.length > 1 && (
                            <span className="text-[10px] text-faint">all</span>
                          )}
                        {o.reset ? (
                          <span className="text-amber-600 font-medium">
                            Reset to defaults
                          </span>
                        ) : (
                          <>
                            {o.contributionRate !== undefined && (
                              <span className="text-emerald-700">
                                Rate: {formatPercent(o.contributionRate)}
                              </span>
                            )}
                            {o.routingMode && (
                              <span className="text-emerald-700">
                                Mode: {o.routingMode}
                              </span>
                            )}
                            {o.accountOrder && (
                              <span className="text-emerald-700">
                                Order: {o.accountOrder.join("→")}
                              </span>
                            )}
                            {o.accountCaps && (
                              <span className="text-emerald-700">
                                Caps:{""}
                                {Object.entries(o.accountCaps)
                                  .map(
                                    ([k, v]) =>
                                      `${catDisplayLabel[k] ?? k}=${formatCurrency(v as number)}`,
                                  )
                                  .join(",")}
                              </span>
                            )}
                            {o.taxSplits && (
                              <span className="text-emerald-700">
                                Tax:{""}
                                {Object.entries(o.taxSplits)
                                  .map(
                                    ([k, v]) =>
                                      `${catDisplayLabel[k] ?? k}=${formatPercent(v as number)}R`,
                                  )
                                  .join(",")}
                              </span>
                            )}
                            {o.taxTypeCaps && (
                              <span className="text-emerald-700">
                                TaxCaps:{""}
                                {Object.entries(o.taxTypeCaps)
                                  .map(
                                    ([k, v]) =>
                                      `${k === "traditional" ? "Trad" : k === "roth" ? "Roth" : k}=${formatCurrency(v as number)}`,
                                  )
                                  .join(",")}
                              </span>
                            )}
                          </>
                        )}
                        {o.lumpSums && o.lumpSums.length > 0 && (
                          <span className="text-emerald-700">
                            {o.lumpSums.map((ls, k) => (
                              <span key={k}>
                                +{formatCurrency(ls.amount)}{ls.label ? ` ${ls.label}` : ""} → {catDisplayLabel[ls.targetAccount] ?? ls.targetAccount}
                              </span>
                            ))}
                          </span>
                        )}
                        {o.notes && (
                          <span className="text-emerald-400">({o.notes})</span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="text-emerald-400 hover:text-red-500 ml-2"
                        onClick={() =>
                          setAccumOverrides((prev) =>
                            prev.filter((_, j) => j !== i),
                          )
                        }
                        aria-label="Remove override"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add form */}
              {showAccumForm && (
                <div className="bg-surface-sunken border rounded-lg p-3 space-y-3 text-sm">
                  <div className="flex flex-wrap gap-3 items-end">
                    <label className="block">
                      <span className="text-xs text-muted">Year</span>
                      <input
                        type="number"
                        value={accumForm.year}
                        onChange={(e) =>
                          setAccumForm((f) => ({ ...f, year: e.target.value }))
                        }
                        className="mt-1 block w-20 rounded border border-strong px-2 py-1 text-sm"
                      />
                    </label>
                    {enginePeople && enginePeople.length > 1 && (
                      <label className="block">
                        <span className="text-xs text-muted">
                          Person
                          <HelpTip text="Apply this override to a specific person or the whole household." />
                        </span>
                        <select
                          value={accumForm.personName}
                          onChange={(e) =>
                            setAccumForm((f) => ({
                              ...f,
                              personName: e.target.value,
                            }))
                          }
                          className="mt-1 block rounded border border-strong px-2 py-1 text-sm"
                        >
                          <option value="">Everyone</option>
                          {enginePeople.map((p) => (
                            <option key={p.id} value={p.name}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label className="flex items-center gap-1.5 text-xs text-muted">
                      <input
                        type="checkbox"
                        checked={accumForm.reset}
                        onChange={(e) =>
                          setAccumForm((f) => ({
                            ...f,
                            reset: e.target.checked,
                          }))
                        }
                        className="rounded border-strong"
                      />
                      Reset to defaults
                      <HelpTip text="Revert all saving settings back to the defaults from this year onward." />
                    </label>
                  </div>

                  {!accumForm.reset && (
                    <>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <label className="block">
                          <span className="text-xs text-muted">
                            Contribution Rate %
                            <HelpTip text="Ceiling on total contributions as a % of salary. Auto-derived from your current contributions ÷ compensation. If per-account totals exceed this ceiling, all accounts are scaled down proportionally. Override here to raise or lower the cap from this year onward. Leave blank to keep the current rate." />
                          </span>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            placeholder="e.g. 30"
                            value={accumForm.contributionRate}
                            onChange={(e) =>
                              setAccumForm((f) => ({
                                ...f,
                                contributionRate: e.target.value,
                              }))
                            }
                            className="mt-1 block w-full rounded border border-strong px-2 py-1 text-sm"
                          />
                        </label>
                        <label className="block">
                          <span className="text-xs text-muted">
                            Routing Mode
                          </span>
                          <select
                            value={accumForm.routingMode}
                            onChange={(e) =>
                              setAccumForm((f) => ({
                                ...f,
                                routingMode: e.target.value as
                                  | ""
                                  | "waterfall"
                                  | "percentage",
                              }))
                            }
                            className="mt-1 block w-full rounded border border-strong px-2 py-1 text-sm"
                          >
                            <option value="">No change</option>
                            <option value="waterfall">Waterfall</option>
                            <option value="percentage">Percentage</option>
                          </select>
                        </label>
                      </div>

                      {/* Account order (waterfall priority) */}
                      <div>
                        <span className="text-xs text-muted">
                          Waterfall Order
                          <HelpTip text="Priority order for waterfall routing. Reorder to change which accounts fill first. Only applies in waterfall mode." />
                        </span>
                        <div className="flex gap-1 mt-1">
                          {accumForm.accountOrder.map((cat, idx) => (
                            <div
                              key={cat}
                              className="flex items-center gap-0.5"
                            >
                              <span className="text-xs bg-surface-elevated rounded px-2 py-1 font-medium">
                                {idx + 1}.{""}
                                {getAccountTypeConfig(cat).displayLabel}
                              </span>
                              {idx > 0 && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setAccumForm((f) => {
                                      const order = [...f.accountOrder];
                                      const tmp = order[idx - 1]!;
                                      order[idx - 1] = order[idx]!;
                                      order[idx] = tmp;
                                      return { ...f, accountOrder: order };
                                    })
                                  }
                                  className="text-faint hover:text-secondary text-[10px]"
                                  title="Move up"
                                >
                                  ←
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Account splits (percentage mode) */}
                      <div>
                        <span className="text-xs text-muted">
                          Account Splits (%)
                          <HelpTip text="Percentage allocation per account in percentage routing mode. Should total 100% — if an account has insufficient room, excess redistributes proportionally. Leave all blank = no change." />
                        </span>
                        <div className="grid grid-cols-4 gap-2 mt-1">
                          {ALL_CATEGORIES.map((cat) => (
                            <input
                              key={cat}
                              type="number"
                              min={0}
                              max={100}
                              placeholder={`${getAccountTypeConfig(cat).displayLabel} %`}
                              value={accumForm.accountSplits[cat]}
                              onChange={(e) =>
                                setAccumForm((f) => ({
                                  ...f,
                                  accountSplits: {
                                    ...f.accountSplits,
                                    [cat]: e.target.value,
                                  },
                                }))
                              }
                              className="rounded border border-strong px-2 py-1 text-sm"
                            />
                          ))}
                        </div>
                      </div>

                      {/* Account caps */}
                      <div>
                        <span className="text-xs text-muted">
                          Account Caps ($)
                          <HelpTip text="Set a dollar cap below the IRS limit for specific accounts. Leave blank = no change. Enter 0 to clear a cap from a previous override. Excess overflows to next account." />
                        </span>
                        <div className="grid grid-cols-4 gap-2 mt-1">
                          {ALL_CATEGORIES.map((cat) => (
                            <input
                              key={cat}
                              type="number"
                              placeholder={
                                getAccountTypeConfig(cat).displayLabel
                              }
                              value={accumForm.accountCaps[cat]}
                              onChange={(e) =>
                                setAccumForm((f) => ({
                                  ...f,
                                  accountCaps: {
                                    ...f.accountCaps,
                                    [cat]: e.target.value,
                                  },
                                }))
                              }
                              className="rounded border border-strong px-2 py-1 text-sm"
                            />
                          ))}
                        </div>
                      </div>

                      {/* Tax splits — one field per unique limit group */}
                      <div className="grid grid-cols-2 gap-3">
                        {Object.keys(accumForm.taxSplits).map((groupKey) => {
                          const repCat = categoriesWithTaxPreference().find(
                            (c) => (getLimitGroup(c) ?? c) === groupKey,
                          );
                          const label = repCat
                            ? getAccountTypeConfig(repCat).displayLabel
                            : groupKey;
                          return (
                            <label key={groupKey} className="block">
                              <span className="text-xs text-muted">
                                {label} Roth %
                                <HelpTip
                                  text={`Percentage of ${label} contributions that go to Roth (tax-free). The rest goes to Traditional (pre-tax). Leave blank = keep current.`}
                                />
                              </span>
                              <input
                                type="number"
                                min={0}
                                max={100}
                                placeholder="e.g. 70"
                                value={accumForm.taxSplits[groupKey]}
                                onChange={(e) =>
                                  setAccumForm((f) => ({
                                    ...f,
                                    taxSplits: {
                                      ...f.taxSplits,
                                      [groupKey]: e.target.value,
                                    },
                                  }))
                                }
                                className="mt-1 block w-full rounded border border-strong px-2 py-1 text-sm"
                              />
                            </label>
                          );
                        })}
                      </div>

                      {/* Tax type caps */}
                      <div className="grid grid-cols-2 gap-3">
                        <label className="block">
                          <span className="text-xs text-muted">
                            {taxTypeLabel("preTax")} Cap ($)
                            <HelpTip text="Max total traditional (pre-tax) contributions across ALL accounts. Leave blank = no change. Enter 0 to clear a cap from a previous override." />
                          </span>
                          <input
                            type="number"
                            placeholder="e.g. 20000"
                            value={accumForm.taxTypeCaps.traditional}
                            onChange={(e) =>
                              setAccumForm((f) => ({
                                ...f,
                                taxTypeCaps: {
                                  ...f.taxTypeCaps,
                                  traditional: e.target.value,
                                },
                              }))
                            }
                            className="mt-1 block w-full rounded border border-strong px-2 py-1 text-sm"
                          />
                        </label>
                        <label className="block">
                          <span className="text-xs text-muted">
                            {taxTypeLabel("taxFree")} Cap ($)
                            <HelpTip text="Max total Roth (tax-free) contributions across ALL accounts. Leave blank = no change. Enter 0 to clear a cap from a previous override." />
                          </span>
                          <input
                            type="number"
                            placeholder="e.g. 30000"
                            value={accumForm.taxTypeCaps.roth}
                            onChange={(e) =>
                              setAccumForm((f) => ({
                                ...f,
                                taxTypeCaps: {
                                  ...f.taxTypeCaps,
                                  roth: e.target.value,
                                },
                              }))
                            }
                            className="mt-1 block w-full rounded border border-strong px-2 py-1 text-sm"
                          />
                        </label>
                      </div>
                    </>
                  )}

                  {/* Lump Sums */}
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted">
                        Lump Sums
                        <HelpTip text="One-time dollar injections (bonus, inheritance, rollover). Not subject to IRS contribution limits. Only applied in this exact year." />
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setAccumForm((f) => ({
                            ...f,
                            lumpSums: [
                              ...f.lumpSums,
                              { amount: "", targetAccount: ALL_CATEGORIES[0]!, taxType: "" as const, label: "" },
                            ],
                          }))
                        }
                        className="text-[10px] text-emerald-600 hover:underline"
                      >
                        + Add Lump Sum
                      </button>
                    </div>
                    {accumForm.lumpSums.map((ls, li) => (
                      <div key={li} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1 mt-1 items-end">
                        <label className="block">
                          <span className="text-[10px] text-muted">Amount</span>
                          <input
                            type="number"
                            min={0}
                            placeholder="$50,000"
                            value={ls.amount}
                            onChange={(e) =>
                              setAccumForm((f) => ({
                                ...f,
                                lumpSums: f.lumpSums.map((x, j) => j === li ? { ...x, amount: e.target.value } : x),
                              }))
                            }
                            className="mt-0.5 block w-full rounded border border-strong px-2 py-1 text-sm"
                          />
                        </label>
                        <label className="block">
                          <span className="text-[10px] text-muted">Account</span>
                          <select
                            value={ls.targetAccount}
                            onChange={(e) =>
                              setAccumForm((f) => ({
                                ...f,
                                lumpSums: f.lumpSums.map((x, j) => j === li ? { ...x, targetAccount: e.target.value as typeof ls.targetAccount } : x),
                              }))
                            }
                            className="mt-0.5 block w-full rounded border border-strong px-2 py-1 text-sm"
                          >
                            {ALL_CATEGORIES.map((cat) => (
                              <option key={cat} value={cat}>
                                {catDisplayLabel[cat] ?? cat}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block">
                          <span className="text-[10px] text-muted">Label</span>
                          <input
                            type="text"
                            placeholder="Inheritance"
                            value={ls.label}
                            onChange={(e) =>
                              setAccumForm((f) => ({
                                ...f,
                                lumpSums: f.lumpSums.map((x, j) => j === li ? { ...x, label: e.target.value } : x),
                              }))
                            }
                            className="mt-0.5 block w-full rounded border border-strong px-2 py-1 text-sm"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() =>
                            setAccumForm((f) => ({
                              ...f,
                              lumpSums: f.lumpSums.filter((_, j) => j !== li),
                            }))
                          }
                          className="text-red-400 hover:text-red-600 text-xs pb-1"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>

                  <label className="block">
                    <span className="text-xs text-muted">Notes</span>
                    <input
                      type="text"
                      placeholder="e.g. Switch to mostly Roth"
                      value={accumForm.notes}
                      onChange={(e) =>
                        setAccumForm((f) => ({ ...f, notes: e.target.value }))
                      }
                      className="mt-1 block w-full rounded border border-strong px-2 py-1 text-sm"
                    />
                  </label>

                  <button
                    type="button"
                    onClick={handleAddAccumOverride}
                    className="bg-emerald-600 text-white text-xs rounded px-3 py-1.5 hover:bg-emerald-700"
                  >
                    Add Override
                  </button>
                </div>
              )}
            </div>

            {/* --- WITHDRAWAL OVERRIDES --- */}
            <div className="border-t border-subtle pt-3">
              <div className="flex items-center justify-between mb-2">
                <h5 className="text-[11px] font-medium text-muted uppercase tracking-wide">
                  Withdrawal
                  <HelpTip text="Change withdrawal rate, routing mode, account caps, tax preferences, or Roth conversion target at a specific retirement year. RMDs are always enforced regardless of overrides." />
                </h5>
                <button
                  type="button"
                  onClick={() => setShowDecumForm(!showDecumForm)}
                  className="text-[11px] text-amber-600 hover:underline"
                >
                  {showDecumForm ? "Cancel" : "+ Add"}
                </button>
              </div>

              {/* Existing overrides */}
              {decumOverrides.length > 0 && (
                <div className="space-y-1 mb-2">
                  {decumOverrides.map((o, i) => (
                    <div
                      key={o.year}
                      className="flex items-center justify-between bg-amber-50 rounded px-3 py-1.5 text-xs"
                    >
                      <div className="flex flex-wrap gap-2 items-center">
                        <span className="font-semibold text-amber-800">
                          {o.year}+
                        </span>
                        {o.personName && (
                          <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">
                            {o.personName}
                          </span>
                        )}
                        {!o.personName &&
                          enginePeople &&
                          enginePeople.length > 1 && (
                            <span className="text-[10px] text-faint">all</span>
                          )}
                        {o.reset ? (
                          <span className="text-amber-600 font-medium">
                            Reset to defaults
                          </span>
                        ) : (
                          <>
                            {o.withdrawalRate !== undefined && (
                              <span className="text-amber-700">
                                Rate: {formatPercent(o.withdrawalRate, 1)}
                              </span>
                            )}
                            {o.withdrawalOrder && (
                              <span className="text-amber-700">
                                Order: {o.withdrawalOrder.join("→")}
                              </span>
                            )}
                            {o.withdrawalAccountCaps && (
                              <span className="text-amber-700">
                                Caps:{""}
                                {Object.entries(o.withdrawalAccountCaps)
                                  .map(
                                    ([k, v]) =>
                                      `${catDisplayLabel[k] ?? k}=${formatCurrency(v as number)}`,
                                  )
                                  .join(",")}
                              </span>
                            )}
                            {o.rothConversionTarget !== undefined && (
                              <span className="text-amber-700">
                                Roth Conv:{""}
                                {o.rothConversionTarget === 0
                                  ? "Off"
                                  : `${Math.round(o.rothConversionTarget * 100)}%`}
                              </span>
                            )}
                          </>
                        )}
                        {o.lumpSums && o.lumpSums.length > 0 && (
                          <span className="text-amber-700">
                            {o.lumpSums.map((ls, k) => (
                              <span key={k}>
                                +{formatCurrency(ls.amount)}{ls.label ? ` ${ls.label}` : ""} → {catDisplayLabel[ls.targetAccount] ?? ls.targetAccount}
                              </span>
                            ))}
                          </span>
                        )}
                        {o.notes && (
                          <span className="text-amber-400">({o.notes})</span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="text-amber-400 hover:text-red-500 ml-2"
                        onClick={() =>
                          setDecumOverrides((prev) =>
                            prev.filter((_, j) => j !== i),
                          )
                        }
                        aria-label="Remove override"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add form */}
              {showDecumForm && (
                <div className="bg-surface-sunken border rounded-lg p-3 space-y-3 text-sm">
                  <div className="flex flex-wrap gap-3 items-end">
                    <label className="block">
                      <span className="text-xs text-muted">Year</span>
                      <input
                        type="number"
                        value={decumForm.year}
                        onChange={(e) =>
                          setDecumForm((f) => ({ ...f, year: e.target.value }))
                        }
                        className="mt-1 block w-20 rounded border border-strong px-2 py-1 text-sm"
                      />
                    </label>
                    {enginePeople && enginePeople.length > 1 && (
                      <label className="block">
                        <span className="text-xs text-muted">
                          Person
                          <HelpTip text="Apply this override to a specific person or the whole household." />
                        </span>
                        <select
                          value={decumForm.personName}
                          onChange={(e) =>
                            setDecumForm((f) => ({
                              ...f,
                              personName: e.target.value,
                            }))
                          }
                          className="mt-1 block rounded border border-strong px-2 py-1 text-sm"
                        >
                          <option value="">Everyone</option>
                          {enginePeople.map((p) => (
                            <option key={p.id} value={p.name}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label className="flex items-center gap-1.5 text-xs text-muted">
                      <input
                        type="checkbox"
                        checked={decumForm.reset}
                        onChange={(e) =>
                          setDecumForm((f) => ({
                            ...f,
                            reset: e.target.checked,
                          }))
                        }
                        className="rounded border-strong"
                      />
                      Reset to defaults
                      <HelpTip text="Revert all withdrawal settings back to the defaults from this year onward." />
                    </label>
                  </div>

                  {!decumForm.reset && (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <label className="block">
                          <span className="text-xs text-muted">
                            Withdrawal Rate %
                            <HelpTip text="Annual withdrawal as a percentage of portfolio balance. Leave blank to keep current rate." />
                          </span>
                          <input
                            type="number"
                            min={0}
                            max={20}
                            step={0.1}
                            placeholder="e.g. 3.5"
                            value={decumForm.withdrawalRate}
                            onChange={(e) =>
                              setDecumForm((f) => ({
                                ...f,
                                withdrawalRate: e.target.value,
                              }))
                            }
                            className="mt-1 block w-full rounded border border-strong px-2 py-1 text-sm"
                          />
                        </label>

                        <label className="block">
                          <span className="text-xs text-muted">
                            Roth Conversion Target
                            <HelpTip text="Target tax bracket to fill with Traditional→Roth conversions each year. 'Off' disables conversions. 'Custom' lets you enter any marginal rate. Leave blank to keep current." />
                          </span>
                          <select
                            value={
                              decumForm.rothConversionTarget !== "" &&
                              !rothBracketPresets.includes(
                                decumForm.rothConversionTarget,
                              )
                                ? "custom"
                                : decumForm.rothConversionTarget
                            }
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v === "custom") {
                                setDecumForm((f) => ({
                                  ...f,
                                  rothConversionTarget: "0.12",
                                }));
                              } else {
                                setDecumForm((f) => ({
                                  ...f,
                                  rothConversionTarget: v,
                                }));
                              }
                            }}
                            className="mt-1 block w-full rounded border border-strong px-2 py-1 text-sm"
                          >
                            <option value="">No change</option>
                            {rothBracketPresets.map((p) => (
                              <option key={p} value={p}>
                                {p === "0"
                                  ? "Off (disable conversions)"
                                  : `${Math.round(Number(p) * 100)}% bracket`}
                              </option>
                            ))}
                            <option value="custom">Custom rate...</option>
                          </select>
                        </label>
                      </div>

                      {/* Custom Roth conversion target input */}
                      {decumForm.rothConversionTarget !== "" &&
                        !rothBracketPresets.includes(
                          decumForm.rothConversionTarget,
                        ) && (
                          <label className="block">
                            <span className="text-xs text-muted">
                              Custom marginal rate (decimal)
                              <HelpTip text="Enter the marginal tax rate as a decimal, e.g. 0.15 for 15%." />
                            </span>
                            <input
                              type="number"
                              min={0}
                              max={0.5}
                              step={0.01}
                              placeholder="e.g. 0.15"
                              value={decumForm.rothConversionTarget}
                              onChange={(e) =>
                                setDecumForm((f) => ({
                                  ...f,
                                  rothConversionTarget: e.target.value,
                                }))
                              }
                              className="mt-1 block w-32 rounded border border-strong px-2 py-1 text-sm"
                            />
                          </label>
                        )}

                      <div>
                        <div className="flex items-center gap-2 text-sm">
                          <span className="text-xs text-muted">
                            Routing Mode:
                          </span>
                          <div className="inline-flex rounded-md border bg-surface-sunken p-0.5">
                            <button
                              type="button"
                              onClick={() =>
                                setDecumForm((f) => ({
                                  ...f,
                                  withdrawalRoutingMode:
                                    f.withdrawalRoutingMode === "waterfall"
                                      ? ""
                                      : "waterfall",
                                }))
                              }
                              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                                decumForm.withdrawalRoutingMode === "waterfall"
                                  ? "bg-surface-primary text-primary shadow-sm border"
                                  : "text-muted hover:text-secondary"
                              }`}
                            >
                              Waterfall
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setDecumForm((f) => ({
                                  ...f,
                                  withdrawalRoutingMode:
                                    f.withdrawalRoutingMode === "percentage"
                                      ? ""
                                      : "percentage",
                                }))
                              }
                              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                                decumForm.withdrawalRoutingMode === "percentage"
                                  ? "bg-surface-primary text-primary shadow-sm border"
                                  : "text-muted hover:text-secondary"
                              }`}
                            >
                              Percentage
                            </button>
                          </div>
                          <HelpTip text="Leave unselected to keep current mode. Waterfall drains accounts in order; Percentage splits by fixed %." />
                        </div>
                      </div>

                      {decumForm.withdrawalRoutingMode === "percentage" && (
                        <div>
                          <span className="text-xs text-muted">
                            Withdrawal Splits (%)
                            <HelpTip text="How to split withdrawals across accounts. Should total 100% — if an account has insufficient balance, excess redistributes proportionally." />
                          </span>
                          <div className="grid grid-cols-4 gap-2 mt-1">
                            {ALL_CATEGORIES.map((cat) => (
                              <label key={cat} className="block">
                                <span
                                  className={`text-[10px] font-medium ${accountTextColor(cat)}`}
                                >
                                  {catDisplayLabel[cat] ?? cat}
                                </span>
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  placeholder="0"
                                  value={decumForm.withdrawalSplits[cat]}
                                  onChange={(e) =>
                                    setDecumForm((f) => ({
                                      ...f,
                                      withdrawalSplits: {
                                        ...f.withdrawalSplits,
                                        [cat]: e.target.value,
                                      },
                                    }))
                                  }
                                  className="mt-0.5 block w-full rounded border border-strong px-2 py-1 text-sm text-right"
                                />
                              </label>
                            ))}
                          </div>
                          {(() => {
                            const total = ALL_CATEGORIES.reduce((s, cat) => {
                              const v = parseFloat(
                                decumForm.withdrawalSplits[cat],
                              );
                              return s + (isNaN(v) ? 0 : v);
                            }, 0);
                            const off =
                              total > 0 && Math.abs(total - 100) > 0.1;
                            return off ? (
                              <p className="text-xs text-amber-600 mt-1">
                                Splits sum to {total.toFixed(0)}% — should be
                                100%
                              </p>
                            ) : null;
                          })()}
                        </div>
                      )}

                      {/* Withdrawal order (waterfall priority) */}
                      <div>
                        <span className="text-xs text-muted">
                          Withdrawal Order
                          <HelpTip text="Priority order for waterfall withdrawals. Drains accounts in this order. Only applies in waterfall mode." />
                        </span>
                        <div className="flex gap-1 mt-1">
                          {decumForm.withdrawalOrder.map((cat, idx) => (
                            <div
                              key={cat}
                              className="flex items-center gap-0.5"
                            >
                              <span className="text-xs bg-surface-elevated rounded px-2 py-1 font-medium">
                                {idx + 1}. {catDisplayLabel[cat] ?? cat}
                              </span>
                              {idx > 0 && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDecumForm((f) => {
                                      const order = [...f.withdrawalOrder];
                                      const tmp = order[idx - 1]!;
                                      order[idx - 1] = order[idx]!;
                                      order[idx] = tmp;
                                      return { ...f, withdrawalOrder: order };
                                    })
                                  }
                                  className="text-faint hover:text-secondary text-[10px]"
                                  title="Move up"
                                >
                                  ←
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Tax preference per account */}
                      <div>
                        <span className="text-xs text-muted">
                          Tax Preference
                          <HelpTip text="Which tax bucket to draw from first within each account. Only applies to accounts with both Traditional and Roth balances. Leave blank = no change." />
                        </span>
                        <div className="grid grid-cols-4 gap-2 mt-1">
                          {ALL_CATEGORIES.map((cat) => (
                            <label key={cat} className="block">
                              <span
                                className={`text-[10px] font-medium ${accountTextColor(cat)}`}
                              >
                                {catDisplayLabel[cat] ?? cat}
                              </span>
                              <select
                                value={decumForm.withdrawalTaxPreference[cat]}
                                onChange={(e) =>
                                  setDecumForm((f) => ({
                                    ...f,
                                    withdrawalTaxPreference: {
                                      ...f.withdrawalTaxPreference,
                                      [cat]: e.target.value as
                                        | "traditional"
                                        | "roth"
                                        | "",
                                    },
                                  }))
                                }
                                className="mt-0.5 block w-full rounded border border-strong px-1 py-1 text-xs"
                              >
                                <option value="">No change</option>
                                <option value="traditional">
                                  Traditional first
                                </option>
                                <option value="roth">Roth first</option>
                              </select>
                            </label>
                          ))}
                        </div>
                      </div>

                      <div>
                        <span className="text-xs text-muted">
                          Withdrawal Caps ($)
                          <HelpTip text="Max annual withdrawal per account. Leave blank = no change. Enter 0 to clear a cap from a previous override. Excess shifts to the next account." />
                        </span>
                        <div className="grid grid-cols-4 gap-2 mt-1">
                          {ALL_CATEGORIES.map((cat) => (
                            <input
                              key={cat}
                              type="number"
                              placeholder={catDisplayLabel[cat] ?? cat}
                              value={decumForm.withdrawalAccountCaps[cat]}
                              onChange={(e) =>
                                setDecumForm((f) => ({
                                  ...f,
                                  withdrawalAccountCaps: {
                                    ...f.withdrawalAccountCaps,
                                    [cat]: e.target.value,
                                  },
                                }))
                              }
                              className="rounded border border-strong px-2 py-1 text-sm"
                            />
                          ))}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <label className="block">
                          <span className="text-xs text-muted">
                            {taxTypeLabel("preTax")} Withdrawal Cap ($)
                            <HelpTip text="Max total traditional (pre-tax) withdrawals across ALL accounts per year. Useful for staying in a lower tax bracket. Leave blank = no change." />
                          </span>
                          <input
                            type="number"
                            placeholder="e.g. 80000"
                            value={decumForm.withdrawalTaxTypeCaps.traditional}
                            onChange={(e) =>
                              setDecumForm((f) => ({
                                ...f,
                                withdrawalTaxTypeCaps: {
                                  ...f.withdrawalTaxTypeCaps,
                                  traditional: e.target.value,
                                },
                              }))
                            }
                            className="mt-1 block w-full rounded border border-strong px-2 py-1 text-sm"
                          />
                        </label>
                        <label className="block">
                          <span className="text-xs text-muted">
                            {taxTypeLabel("taxFree")} Withdrawal Cap ($)
                            <HelpTip text="Max total Roth (tax-free) withdrawals across ALL accounts per year. Leave blank = no change." />
                          </span>
                          <input
                            type="number"
                            placeholder="e.g. 50000"
                            value={decumForm.withdrawalTaxTypeCaps.roth}
                            onChange={(e) =>
                              setDecumForm((f) => ({
                                ...f,
                                withdrawalTaxTypeCaps: {
                                  ...f.withdrawalTaxTypeCaps,
                                  roth: e.target.value,
                                },
                              }))
                            }
                            className="mt-1 block w-full rounded border border-strong px-2 py-1 text-sm"
                          />
                        </label>
                      </div>
                    </>
                  )}

                  {/* Lump Sums */}
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted">
                        Lump Sums
                        <HelpTip text="One-time dollar injections during retirement (windfall, inheritance, rollover). Only applied in this exact year." />
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setDecumForm((f) => ({
                            ...f,
                            lumpSums: [
                              ...f.lumpSums,
                              { amount: "", targetAccount: ALL_CATEGORIES[0]!, taxType: "" as const, label: "" },
                            ],
                          }))
                        }
                        className="text-[10px] text-amber-600 hover:underline"
                      >
                        + Add Lump Sum
                      </button>
                    </div>
                    {decumForm.lumpSums.map((ls, li) => (
                      <div key={li} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1 mt-1 items-end">
                        <label className="block">
                          <span className="text-[10px] text-muted">Amount</span>
                          <input
                            type="number"
                            min={0}
                            placeholder="$50,000"
                            value={ls.amount}
                            onChange={(e) =>
                              setDecumForm((f) => ({
                                ...f,
                                lumpSums: f.lumpSums.map((x, j) => j === li ? { ...x, amount: e.target.value } : x),
                              }))
                            }
                            className="mt-0.5 block w-full rounded border border-strong px-2 py-1 text-sm"
                          />
                        </label>
                        <label className="block">
                          <span className="text-[10px] text-muted">Account</span>
                          <select
                            value={ls.targetAccount}
                            onChange={(e) =>
                              setDecumForm((f) => ({
                                ...f,
                                lumpSums: f.lumpSums.map((x, j) => j === li ? { ...x, targetAccount: e.target.value as typeof ls.targetAccount } : x),
                              }))
                            }
                            className="mt-0.5 block w-full rounded border border-strong px-2 py-1 text-sm"
                          >
                            {ALL_CATEGORIES.map((cat) => (
                              <option key={cat} value={cat}>
                                {catDisplayLabel[cat] ?? cat}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block">
                          <span className="text-[10px] text-muted">Label</span>
                          <input
                            type="text"
                            placeholder="Inheritance"
                            value={ls.label}
                            onChange={(e) =>
                              setDecumForm((f) => ({
                                ...f,
                                lumpSums: f.lumpSums.map((x, j) => j === li ? { ...x, label: e.target.value } : x),
                              }))
                            }
                            className="mt-0.5 block w-full rounded border border-strong px-2 py-1 text-sm"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() =>
                            setDecumForm((f) => ({
                              ...f,
                              lumpSums: f.lumpSums.filter((_, j) => j !== li),
                            }))
                          }
                          className="text-red-400 hover:text-red-600 text-xs pb-1"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>

                  <label className="block">
                    <span className="text-xs text-muted">Notes</span>
                    <input
                      type="text"
                      placeholder="e.g. Reduce withdrawals at 75"
                      value={decumForm.notes}
                      onChange={(e) =>
                        setDecumForm((f) => ({ ...f, notes: e.target.value }))
                      }
                      className="mt-1 block w-full rounded border border-strong px-2 py-1 text-sm"
                    />
                  </label>

                  <button
                    type="button"
                    onClick={handleAddDecumOverride}
                    className="bg-amber-600 text-white text-xs rounded px-3 py-1.5 hover:bg-amber-700"
                  >
                    Add Override
                  </button>
                </div>
              )}
            </div>

            {/* --- LIFE CHANGES — contribution & budget --- */}
            <div className="border-t border-subtle pt-3">
              <div className="flex items-center justify-between mb-2">
                <h5 className="text-[11px] font-medium text-muted uppercase tracking-wide">
                  Contribution &amp; Budget
                  <HelpTip text="Per-year overrides for contribution profile (salary + contributions) and monthly budget. Each override sticks forward until the next one. These are saved to the database and persist across sessions." />
                </h5>
                <button
                  type="button"
                  onClick={() => setShowLifeOverrides(!showLifeOverrides)}
                  className="text-[11px] text-muted hover:underline"
                >
                  {showLifeOverrides ? "Collapse" : "Expand"}
                </button>
              </div>

              {/* Compact summary when collapsed */}
              {!showLifeOverrides && (
                <div className="flex flex-wrap gap-3 text-xs text-faint">
                  {(dbSalaryOverrides ?? []).length > 0 && (
                    <span>
                      {dbSalaryOverrides!.length} contribution override
                      {dbSalaryOverrides!.length !== 1 ? "s" : ""}
                    </span>
                  )}
                  {(dbBudgetOverrides ?? []).length > 0 && (
                    <span>
                      {dbBudgetOverrides!.length} budget override
                      {dbBudgetOverrides!.length !== 1 ? "s" : ""}
                    </span>
                  )}
                  {!dbSalaryOverrides?.length && !dbBudgetOverrides?.length && (
                    <span>None</span>
                  )}
                </div>
              )}

              {showLifeOverrides && (
                <div className="space-y-4">
                  {/* Contribution Overrides */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-medium text-muted uppercase">
                        Contribution
                        <HelpTip text="Override the contribution profile (salary + contributions) at a specific future year. The salary from the selected profile is adjusted to future dollars using your Pre-Retirement Raise rate." />
                        {isPersonFiltered && (
                          <span className="text-blue-500 normal-case font-normal ml-1">
                            ({personFilterName})
                          </span>
                        )}
                      </span>
                      {!showSalaryForm && (
                        <button
                          type="button"
                          className="text-[11px] text-blue-600 hover:underline"
                          onClick={() => setShowSalaryForm(true)}
                        >
                          + Add
                        </button>
                      )}
                    </div>
                    {(dbSalaryOverrides ?? []).length > 0 && (
                      <div className="space-y-1 mb-2">
                        {(dbSalaryOverrides ?? []).map((o) => (
                          <div
                            key={o.id}
                            className="flex items-center justify-between bg-surface-sunken rounded px-3 py-1.5 text-xs"
                          >
                            <span>
                              <span className="font-medium">
                                {o.projectionYear}
                              </span>
                              {" → "}
                              {o.contributionProfileId
                                ? (() => {
                                    const profile = s.contribProfileSummaries?.find(
                                      (p) => p.id === o.contributionProfileId,
                                    );
                                    return profile
                                      ? `${profile.name} (${formatCurrency(o.overrideSalary)}/yr)`
                                      : `${formatCurrency(o.overrideSalary)}/yr`;
                                  })()
                                : `${formatCurrency(o.overrideSalary)}/yr`}
                              {enginePeople && enginePeople.length > 1 && (
                                <span className="text-blue-500 text-[10px] ml-1">
                                  [
                                  {enginePeople.find((p) => p.id === o.personId)
                                    ?.name ?? "?"}
                                  ]
                                </span>
                              )}
                              {o.notes && (
                                <span className="text-faint ml-1">
                                  ({o.notes})
                                </span>
                              )}
                            </span>
                            <button
                              type="button"
                              className="text-red-400 hover:text-red-600 ml-2 text-sm"
                              onClick={() =>
                                deleteSalaryOverride.mutate({ id: o.id })
                              }
                              aria-label="Remove contribution override"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {showSalaryForm && (
                      <div className="bg-surface-sunken border rounded-lg p-3 space-y-2">
                        <div className="flex gap-2 items-end flex-wrap">
                          <label className="block">
                            <span className="text-[10px] text-muted">Year</span>
                            <input
                              type="number"
                              value={salaryForm.year}
                              onChange={(e) =>
                                setSalaryForm((f) => ({
                                  ...f,
                                  year: e.target.value,
                                }))
                              }
                              className="mt-0.5 block w-20 rounded border border-strong px-2 py-1 text-xs"
                            />
                          </label>
                          <label className="block">
                            <span className="text-[10px] text-muted">
                              Source
                            </span>
                            <select
                              value={salaryForm.source}
                              onChange={(e) =>
                                setSalaryForm((f) => ({
                                  ...f,
                                  source: e.target.value as "custom" | "profile",
                                }))
                              }
                              className="mt-0.5 block rounded border border-strong px-2 py-1 text-xs"
                            >
                              {s.contribProfileSummaries &&
                                s.contribProfileSummaries.length > 0 && (
                                  <option value="profile">
                                    From contribution profile
                                  </option>
                                )}
                              <option value="custom">Custom amount</option>
                            </select>
                          </label>
                          {salaryForm.source === "profile" &&
                            s.contribProfileSummaries && (
                              <label className="block">
                                <span className="text-[10px] text-muted">
                                  Profile
                                </span>
                                <select
                                  value={salaryForm.profileId}
                                  onChange={(e) =>
                                    setSalaryForm((f) => ({
                                      ...f,
                                      profileId: e.target.value,
                                    }))
                                  }
                                  className="mt-0.5 block rounded border border-strong px-2 py-1 text-xs"
                                >
                                  <option value="">Select...</option>
                                  {s.contribProfileSummaries
                                    .slice()
                                    .sort((a, b) =>
                                      a.isDefault === b.isDefault
                                        ? 0
                                        : a.isDefault
                                          ? -1
                                          : 1,
                                    )
                                    .map((cp) => (
                                      <option
                                        key={cp.id}
                                        value={String(cp.id)}
                                      >
                                        {cp.isDefault ? "\u2713 " : ""}
                                        {cp.name} (
                                        {formatCurrency(cp.summary.combinedSalary)}
                                        /yr)
                                      </option>
                                    ))}
                                </select>
                              </label>
                            )}
                          {salaryForm.source === "custom" && (
                            <label className="block flex-1">
                              <span className="text-[10px] text-muted">
                                Annual Salary ($)
                              </span>
                              <input
                                type="number"
                                value={salaryForm.value}
                                onChange={(e) =>
                                  setSalaryForm((f) => ({
                                    ...f,
                                    value: e.target.value,
                                  }))
                                }
                                className="mt-0.5 block w-full rounded border border-strong px-2 py-1 text-xs"
                              />
                            </label>
                          )}
                          <label className="block flex-1">
                            <span className="text-[10px] text-muted">
                              Notes
                            </span>
                            <input
                              type="text"
                              value={salaryForm.notes}
                              onChange={(e) =>
                                setSalaryForm((f) => ({
                                  ...f,
                                  notes: e.target.value,
                                }))
                              }
                              placeholder="e.g. New job, Promotion"
                              className="mt-0.5 block w-full rounded border border-strong px-2 py-1 text-xs"
                            />
                          </label>
                        </div>
                        {/* Preview resolved value for profile source */}
                        {salaryForm.source === "profile" &&
                          salaryForm.profileId &&
                          salaryForm.year &&
                          (() => {
                            const profile = s.contribProfileSummaries?.find(
                              (p) => String(p.id) === salaryForm.profileId,
                            );
                            if (!profile) return null;
                            const baseSalary = profile.summary.combinedSalary;
                            const yr = parseInt(salaryForm.year);
                            const currentYear = new Date().getFullYear();
                            const yearsOut = Math.max(0, yr - currentYear);
                            const raiseRate = s.engineSettings?.salaryAnnualIncrease
                              ? Number(s.engineSettings.salaryAnnualIncrease)
                              : 0;
                            const futureSalary =
                              baseSalary * Math.pow(1 + raiseRate, yearsOut);
                            return (
                              <p className="text-[10px] text-muted">
                                {profile.name}: {formatCurrency(baseSalary)}/yr today
                                {yearsOut > 0 && raiseRate > 0 && (
                                  <>
                                    {" → "}
                                    <span className="font-medium text-emerald-600">
                                      {formatCurrency(futureSalary)}/yr
                                    </span>
                                    {" in "}
                                    {yr} ({formatPercent(raiseRate)}/yr raise
                                    {" × "}
                                    {yearsOut}yr)
                                  </>
                                )}
                              </p>
                            );
                          })()}
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className="bg-blue-600 text-white text-xs rounded px-3 py-1 hover:bg-blue-700"
                            onClick={() => {
                              if (!salaryOverridePersonId) return;
                              const yr = parseInt(salaryForm.year);
                              if (isNaN(yr)) return;

                              let resolvedSalary: number;
                              let notes = salaryForm.notes || "";

                              let contributionProfileId: number | null = null;

                              if (salaryForm.source === "profile") {
                                const profile = s.contribProfileSummaries?.find(
                                  (p) => String(p.id) === salaryForm.profileId,
                                );
                                if (!profile) return;
                                // Store the profile's base salary for display (engine uses full profile data)
                                resolvedSalary = profile.summary.combinedSalary;
                                contributionProfileId = profile.id;
                                // Prepend profile name to notes
                                const profileNote = `Profile: ${profile.name}`;
                                notes = notes
                                  ? `${profileNote} — ${notes}`
                                  : profileNote;
                              } else {
                                resolvedSalary = parseFloat(salaryForm.value);
                                if (isNaN(resolvedSalary)) return;
                              }

                              createSalaryOverride.mutate({
                                personId: salaryOverridePersonId,
                                projectionYear: yr,
                                overrideSalary: String(
                                  Math.round(resolvedSalary * 100) / 100,
                                ),
                                contributionProfileId,
                                notes: notes || null,
                              });
                              setSalaryForm({
                                year: "",
                                source: "profile",
                                profileId: "",
                                value: "",
                                notes: "",
                              });
                              setShowSalaryForm(false);
                            }}
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            className="text-muted text-xs hover:text-secondary"
                            onClick={() => setShowSalaryForm(false)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Budget Overrides */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-medium text-muted uppercase">
                        Budget (Monthly)
                      </span>
                      {!showBudgetForm && (
                        <button
                          type="button"
                          className="text-[11px] text-blue-600 hover:underline"
                          onClick={() => setShowBudgetForm(true)}
                        >
                          + Add
                        </button>
                      )}
                    </div>
                    {(dbBudgetOverrides ?? []).length > 0 && (
                      <div className="space-y-1 mb-2">
                        {(dbBudgetOverrides ?? []).map((o) => (
                          <div
                            key={o.id}
                            className="flex items-center justify-between bg-surface-sunken rounded px-3 py-1.5 text-xs"
                          >
                            <span>
                              <span className="font-medium">
                                {o.projectionYear}
                              </span>
                              {" →"}
                              {formatCurrency(o.overrideMonthlyBudget)}/mo (
                              {formatCurrency(o.overrideMonthlyBudget * 12)}/yr)
                              {enginePeople &&
                                enginePeople.length > 1 &&
                                "personId" in o && (
                                  <span className="text-blue-500 text-[10px] ml-1">
                                    [
                                    {enginePeople.find(
                                      (p) =>
                                        p.id ===
                                        (o as { personId: number }).personId,
                                    )?.name ?? "?"}
                                    ]
                                  </span>
                                )}
                              {o.notes && (
                                <span className="text-faint ml-1">
                                  ({o.notes})
                                </span>
                              )}
                            </span>
                            <button
                              type="button"
                              className="text-red-400 hover:text-red-600 ml-2 text-sm"
                              onClick={() =>
                                deleteBudgetOverride.mutate({ id: o.id })
                              }
                              aria-label="Remove budget override"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {showBudgetForm && (
                      <div className="bg-surface-sunken border rounded-lg p-3 space-y-2">
                        <div className="flex gap-2 items-end flex-wrap">
                          <label className="block">
                            <span className="text-[10px] text-muted">Year</span>
                            <input
                              type="number"
                              value={budgetForm.year}
                              onChange={(e) =>
                                setBudgetForm((f) => ({
                                  ...f,
                                  year: e.target.value,
                                }))
                              }
                              className="mt-0.5 block w-20 rounded border border-strong px-2 py-1 text-xs"
                            />
                          </label>
                          <label className="block">
                            <span className="text-[10px] text-muted">
                              Source
                            </span>
                            <select
                              value={budgetForm.source}
                              onChange={(e) =>
                                setBudgetForm((f) => ({
                                  ...f,
                                  source: e.target.value as
                                    | "custom"
                                    | "profile",
                                }))
                              }
                              className="mt-0.5 block rounded border border-strong px-2 py-1 text-xs"
                            >
                              <option value="custom">Custom amount</option>
                              {budgetProfileSummaries &&
                                budgetProfileSummaries.length > 0 && (
                                  <option value="profile">
                                    From budget profile
                                  </option>
                                )}
                            </select>
                          </label>
                          {budgetForm.source === "profile" &&
                            budgetProfileSummaries && (
                              <>
                                <label className="block">
                                  <span className="text-[10px] text-muted">
                                    Profile
                                  </span>
                                  <select
                                    value={budgetForm.profileId}
                                    onChange={(e) =>
                                      setBudgetForm((f) => ({
                                        ...f,
                                        profileId: e.target.value,
                                        profileColumn: "0",
                                      }))
                                    }
                                    className="mt-0.5 block rounded border border-strong px-2 py-1 text-xs"
                                  >
                                    <option value="">Select...</option>
                                    {budgetProfileSummaries
                                      .slice()
                                      .sort((a, b) =>
                                        a.isActive === b.isActive
                                          ? 0
                                          : a.isActive
                                            ? -1
                                            : 1,
                                      )
                                      .map((bp) => (
                                        <option
                                          key={bp.id}
                                          value={String(bp.id)}
                                        >
                                          {bp.isActive ? "\u2713" : ""}
                                          {bp.name} (
                                          {formatCurrency(
                                            bp.columnTotals[0] ?? 0,
                                          )}
                                          /mo)
                                        </option>
                                      ))}
                                  </select>
                                </label>
                                {budgetForm.profileId &&
                                  (() => {
                                    const profile = budgetProfileSummaries.find(
                                      (p) =>
                                        String(p.id) === budgetForm.profileId,
                                    );
                                    if (
                                      !profile ||
                                      profile.columnLabels.length <= 1
                                    )
                                      return null;
                                    return (
                                      <label className="block">
                                        <span className="text-[10px] text-muted">
                                          Column
                                        </span>
                                        <select
                                          value={budgetForm.profileColumn}
                                          onChange={(e) =>
                                            setBudgetForm((f) => ({
                                              ...f,
                                              profileColumn: e.target.value,
                                            }))
                                          }
                                          className="mt-0.5 block rounded border border-strong px-2 py-1 text-xs"
                                        >
                                          {profile.columnLabels.map(
                                            (label, i) => (
                                              <option key={i} value={String(i)}>
                                                {label || `Col ${i + 1}`} (
                                                {formatCurrency(
                                                  profile.columnTotals[i] ?? 0,
                                                )}
                                                /mo)
                                              </option>
                                            ),
                                          )}
                                        </select>
                                      </label>
                                    );
                                  })()}
                              </>
                            )}
                          {budgetForm.source === "custom" && (
                            <label className="block flex-1">
                              <span className="text-[10px] text-muted">
                                Monthly Budget ($)
                              </span>
                              <input
                                type="number"
                                value={budgetForm.value}
                                onChange={(e) =>
                                  setBudgetForm((f) => ({
                                    ...f,
                                    value: e.target.value,
                                  }))
                                }
                                className="mt-0.5 block w-full rounded border border-strong px-2 py-1 text-xs"
                              />
                            </label>
                          )}
                          <label className="block flex-1">
                            <span className="text-[10px] text-muted">
                              Notes
                            </span>
                            <input
                              type="text"
                              value={budgetForm.notes}
                              onChange={(e) =>
                                setBudgetForm((f) => ({
                                  ...f,
                                  notes: e.target.value,
                                }))
                              }
                              placeholder="e.g. Post-mortgage"
                              className="mt-0.5 block w-full rounded border border-strong px-2 py-1 text-xs"
                            />
                          </label>
                        </div>
                        {/* Preview resolved value for profile source */}
                        {budgetForm.source === "profile" &&
                          budgetForm.profileId &&
                          (() => {
                            const profile = budgetProfileSummaries?.find(
                              (p) => String(p.id) === budgetForm.profileId,
                            );
                            if (!profile) return null;
                            const colIdx =
                              parseInt(budgetForm.profileColumn, 10) || 0;
                            const monthly = profile.columnTotals[colIdx] ?? 0;
                            const yr = parseInt(budgetForm.year);
                            const currentYear = new Date().getFullYear();
                            const yearsOut =
                              !isNaN(yr) ? Math.max(0, yr - currentYear) : 0;
                            const inflationRate =
                              s.engineSettings?.annualInflation
                                ? Number(s.engineSettings.annualInflation)
                                : 0;
                            const futureMonthly =
                              monthly * Math.pow(1 + inflationRate, yearsOut);
                            return (
                              <p className="text-[10px] text-muted">
                                {formatCurrency(monthly)}/mo today
                                {yearsOut > 0 && inflationRate > 0 && (
                                  <>
                                    {" → "}
                                    <span className="font-medium text-emerald-600">
                                      {formatCurrency(futureMonthly)}/mo
                                    </span>
                                    {" in "}
                                    {yr} ({formatPercent(inflationRate)}/yr
                                    inflation × {yearsOut}yr)
                                  </>
                                )}
                              </p>
                            );
                          })()}
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className="bg-blue-600 text-white text-xs rounded px-3 py-1 hover:bg-blue-700"
                            onClick={() => {
                              const budgetPersonId =
                                isPersonFiltered && enginePeople
                                  ? (enginePeople.find(
                                      (p) => p.id === personFilter,
                                    )?.id ?? primaryPersonId)
                                  : primaryPersonId;
                              if (!budgetPersonId) return;
                              const yr = parseInt(budgetForm.year);
                              if (isNaN(yr)) return;

                              let resolvedValue: number;
                              let resolvedNotes = budgetForm.notes || null;

                              if (
                                budgetForm.source === "profile" &&
                                budgetForm.profileId
                              ) {
                                const profile = budgetProfileSummaries?.find(
                                  (p) => String(p.id) === budgetForm.profileId,
                                );
                                if (!profile) return;
                                const colIdx =
                                  parseInt(budgetForm.profileColumn, 10) || 0;
                                const todayMonthly =
                                  profile.columnTotals[colIdx] ?? 0;
                                // Inflate to future dollars at the target year
                                const currentYear = new Date().getFullYear();
                                const yearsOut = Math.max(0, yr - currentYear);
                                const inflationRate =
                                  s.engineSettings?.annualInflation
                                    ? Number(s.engineSettings.annualInflation)
                                    : 0;
                                resolvedValue =
                                  todayMonthly *
                                  Math.pow(1 + inflationRate, yearsOut);
                                const colLabel =
                                  profile.columnLabels[colIdx] ?? "";
                                const prefix = `Budget: ${profile.name}${colLabel ? ` (${colLabel})` : ""}`;
                                if (yearsOut > 0 && inflationRate > 0) {
                                  const inflNote = `${formatCurrency(todayMonthly)}/mo today → ${formatCurrency(resolvedValue)}/mo in ${yr}`;
                                  resolvedNotes = resolvedNotes
                                    ? `${prefix} — ${inflNote} — ${resolvedNotes}`
                                    : `${prefix} — ${inflNote}`;
                                } else {
                                  resolvedNotes = resolvedNotes
                                    ? `${prefix} — ${resolvedNotes}`
                                    : prefix;
                                }
                              } else {
                                resolvedValue = parseFloat(budgetForm.value);
                                if (isNaN(resolvedValue)) return;
                              }

                              createBudgetOverride.mutate({
                                personId: budgetPersonId,
                                projectionYear: yr,
                                overrideMonthlyBudget: String(resolvedValue),
                                notes: resolvedNotes,
                              });
                              setBudgetForm({
                                year: "",
                                source: "custom",
                                profileId: "",
                                profileColumn: "0",
                                value: "",
                                notes: "",
                              });
                              setShowBudgetForm(false);
                            }}
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            className="text-muted text-xs hover:text-secondary"
                            onClick={() => setShowBudgetForm(false)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Current baseline info */}
                  <div className="text-[10px] text-faint border-t border-subtle pt-2">
                    {isPersonFiltered && salaryByPerson && enginePeople
                      ? (() => {
                          const person = enginePeople.find(
                            (p) => p.id === personFilter,
                          );
                          const personSal =
                            person && salaryByPerson[person.id] != null
                              ? salaryByPerson[person.id]!
                              : combinedSalary;
                          return `${personFilterName}'s income: ${formatCurrency(personSal)}`;
                        })()
                      : `Current income (salary + bonus): ${formatCurrency(combinedSalary)}`}
                    {" |"}
                    {accumulationExpenseOverride != null
                      ? "Expense override"
                      : "Current budget"}
                    : {formatCurrency(annualExpenses)}/yr (
                    {formatCurrency(annualExpenses / 12)}/mo)
                  </div>
                </div>
              )}
            </div>
          </div>
  );
}
