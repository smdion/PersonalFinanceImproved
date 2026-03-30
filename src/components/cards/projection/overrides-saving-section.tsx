"use client";

/** Saving (accumulation) overrides — existing override badges + inline add form. */
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { taxTypeLabel } from "@/lib/utils/colors";
import {
  getAccountTypeConfig,
  categoriesWithTaxPreference,
  getLimitGroup,
} from "@/lib/config/account-types";
import { ALL_CATEGORIES, catDisplayLabel } from "./utils";
import type { OverridesSectionProps } from "./overrides-panel";
import { accumOverrideToForm } from "./types";

export function SavingOverridesSection({ state: s }: OverridesSectionProps) {
  const {
    accumOverrides,
    setAccumOverrides,
    showAccumForm,
    setShowAccumForm,
    accumForm,
    setAccumForm,
    enginePeople,
    handleAddAccumOverride,
    individualAccountNames,
  } = s;

  return (
    <div className="border-t border-subtle pt-3">
      <div className="flex items-center justify-between mb-2">
        <h5 className="text-[11px] font-medium text-muted uppercase tracking-wide">
          Pre-Retirement
          <HelpTip text="Overrides during the saving phase — change contribution rate, routing mode, account order, tax splits, caps, or add lump sums. Changes carry forward until the next override." />
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
                {!o.personName && enginePeople && enginePeople.length > 1 && (
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
                        Caps:{" "}
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
                        Tax:{" "}
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
                        TaxCaps:{" "}
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
                    {o.lumpSums.map((ls) => (
                      <span key={ls.id}>
                        +{formatCurrency(ls.amount)}
                        {ls.label ? ` ${ls.label}` : ""} →{" "}
                        {catDisplayLabel[ls.targetAccount] ?? ls.targetAccount}
                      </span>
                    ))}
                  </span>
                )}
                {o.notes && (
                  <span className="text-emerald-400">({o.notes})</span>
                )}
              </div>
              <span className="flex items-center gap-1 ml-2">
                <button
                  type="button"
                  className="text-emerald-400 hover:text-emerald-600"
                  onClick={() => {
                    setAccumForm(accumOverrideToForm(o));
                    setShowAccumForm(true);
                  }}
                  aria-label="Edit override"
                >
                  &#9998;
                </button>
                <button
                  type="button"
                  className="text-emerald-400 hover:text-red-500"
                  onClick={() =>
                    setAccumOverrides((prev) => prev.filter((_, j) => j !== i))
                  }
                  aria-label="Remove override"
                >
                  ×
                </button>
              </span>
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
                  <span className="text-xs text-muted">Routing Mode</span>
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
                    <div key={cat} className="flex items-center gap-0.5">
                      <span className="text-xs bg-surface-elevated rounded px-2 py-1 font-medium">
                        {idx + 1}. {getAccountTypeConfig(cat).displayLabel}
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
                      placeholder={getAccountTypeConfig(cat).displayLabel}
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
                      {
                        id: crypto.randomUUID(),
                        amount: "",
                        targetAccount: ALL_CATEGORIES[0]!,
                        targetAccountName: "",
                        taxType: "" as const,
                        label: "",
                      },
                    ],
                  }))
                }
                className="text-[10px] text-emerald-600 hover:underline"
              >
                + Add Lump Sum
              </button>
            </div>
            {accumForm.lumpSums.map((ls, li) => (
              <div
                key={ls.id}
                className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1 mt-1 items-end"
              >
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
                        lumpSums: f.lumpSums.map((x, j) =>
                          j === li ? { ...x, amount: e.target.value } : x,
                        ),
                      }))
                    }
                    className="mt-0.5 block w-full rounded border border-strong px-2 py-1 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] text-muted">Account</span>
                  <select
                    value={ls.targetAccountName || ls.targetAccount}
                    onChange={(e) => {
                      const val = e.target.value;
                      const acct = individualAccountNames.find(
                        (a) => a.name === val,
                      );
                      setAccumForm((f) => ({
                        ...f,
                        lumpSums: f.lumpSums.map((x, j) =>
                          j === li
                            ? {
                                ...x,
                                targetAccountName: acct ? val : "",
                                targetAccount: acct
                                  ? (acct.category as typeof ls.targetAccount)
                                  : (val as typeof ls.targetAccount),
                              }
                            : x,
                        ),
                      }));
                    }}
                    className="mt-0.5 block w-full rounded border border-strong px-2 py-1 text-sm"
                  >
                    {individualAccountNames.length > 0
                      ? individualAccountNames.map((a) => (
                          <option key={a.name} value={a.name}>
                            {a.name}
                          </option>
                        ))
                      : ALL_CATEGORIES.map((cat) => (
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
                        lumpSums: f.lumpSums.map((x, j) =>
                          j === li ? { ...x, label: e.target.value } : x,
                        ),
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
  );
}
