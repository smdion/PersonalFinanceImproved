"use client";

/** Withdrawal (decumulation) overrides — existing override badges + inline add form. */
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { taxTypeLabel, accountTextColor } from "@/lib/utils/colors";
import { ALL_CATEGORIES, catDisplayLabel } from "./utils";
import type { OverridesSectionProps } from "./overrides-panel";

export function WithdrawalOverridesSection({
  state: s,
}: OverridesSectionProps) {
  const {
    decumOverrides,
    setDecumOverrides,
    showDecumForm,
    setShowDecumForm,
    decumForm,
    setDecumForm,
    enginePeople,
    rothBracketPresets,
    handleAddDecumOverride,
  } = s;

  return (
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
                <span className="font-semibold text-amber-800">{o.year}+</span>
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
                    {o.lumpSums.map((ls) => (
                      <span key={ls.id}>
                        +{formatCurrency(ls.amount)}
                        {ls.label ? ` ${ls.label}` : ""} →{" "}
                        {catDisplayLabel[ls.targetAccount] ?? ls.targetAccount}
                      </span>
                    ))}
                  </span>
                )}
                {o.notes && <span className="text-amber-400">({o.notes})</span>}
              </div>
              <button
                type="button"
                className="text-amber-400 hover:text-red-500 ml-2"
                onClick={() =>
                  setDecumOverrides((prev) => prev.filter((_, j) => j !== i))
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
                  <span className="text-xs text-muted">Routing Mode:</span>
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
                      const v = parseFloat(decumForm.withdrawalSplits[cat]);
                      return s + (isNaN(v) ? 0 : v);
                    }, 0);
                    const off = total > 0 && Math.abs(total - 100) > 0.1;
                    return off ? (
                      <p className="text-xs text-amber-600 mt-1">
                        Splits sum to {total.toFixed(0)}% — should be 100%
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
                    <div key={cat} className="flex items-center gap-0.5">
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
                        <option value="traditional">Traditional first</option>
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
                      {
                        id: crypto.randomUUID(),
                        amount: "",
                        targetAccount: ALL_CATEGORIES[0]!,
                        taxType: "" as const,
                        label: "",
                      },
                    ],
                  }))
                }
                className="text-[10px] text-amber-600 hover:underline"
              >
                + Add Lump Sum
              </button>
            </div>
            {decumForm.lumpSums.map((ls, li) => (
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
                      setDecumForm((f) => ({
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
                    value={ls.targetAccount}
                    onChange={(e) =>
                      setDecumForm((f) => ({
                        ...f,
                        lumpSums: f.lumpSums.map((x, j) =>
                          j === li
                            ? {
                                ...x,
                                targetAccount: e.target
                                  .value as typeof ls.targetAccount,
                              }
                            : x,
                        ),
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
  );
}
