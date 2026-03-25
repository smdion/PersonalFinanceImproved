"use client";

/** Contribution & Budget (life change) overrides — salary profile switching + budget overrides. */
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import type { OverridesSectionProps } from "./overrides-panel";

export function LifeChangesSection({
  state: s,
  accumulationExpenseOverride,
}: OverridesSectionProps) {
  const {
    showSalaryForm,
    setShowSalaryForm,
    salaryForm,
    setSalaryForm,
    showBudgetForm,
    setShowBudgetForm,
    budgetForm,
    setBudgetForm,
    showLifeOverrides,
    setShowLifeOverrides,
    personFilter,
    isPersonFiltered,
    personFilterName,
    dbSalaryOverrides,
    dbBudgetOverrides,
    salaryByPerson,
    budgetProfileSummaries,
    enginePeople,
    primaryPersonId,
    salaryOverridePersonId,
    combinedSalary,
    annualExpenses,
    createSalaryOverride,
    deleteSalaryOverride,
    createBudgetOverride,
    deleteBudgetOverride,
  } = s;

  return (
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
                      <span className="font-medium">{o.projectionYear}</span>
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
                        <span className="text-faint ml-1">({o.notes})</span>
                      )}
                    </span>
                    <button
                      type="button"
                      className="text-red-400 hover:text-red-600 ml-2 text-sm"
                      onClick={() => deleteSalaryOverride.mutate({ id: o.id })}
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
                    <span className="text-[10px] text-muted">Source</span>
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
                        <span className="text-[10px] text-muted">Profile</span>
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
                              <option key={cp.id} value={String(cp.id)}>
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
                    <span className="text-[10px] text-muted">Notes</span>
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
                        resolvedSalary = profile.summary.combinedSalary;
                        contributionProfileId = profile.id;
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
                      <span className="font-medium">{o.projectionYear}</span>
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
                                p.id === (o as { personId: number }).personId,
                            )?.name ?? "?"}
                            ]
                          </span>
                        )}
                      {o.notes && (
                        <span className="text-faint ml-1">({o.notes})</span>
                      )}
                    </span>
                    <button
                      type="button"
                      className="text-red-400 hover:text-red-600 ml-2 text-sm"
                      onClick={() => deleteBudgetOverride.mutate({ id: o.id })}
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
                    <span className="text-[10px] text-muted">Source</span>
                    <select
                      value={budgetForm.source}
                      onChange={(e) =>
                        setBudgetForm((f) => ({
                          ...f,
                          source: e.target.value as "custom" | "profile",
                        }))
                      }
                      className="mt-0.5 block rounded border border-strong px-2 py-1 text-xs"
                    >
                      <option value="custom">Custom amount</option>
                      {budgetProfileSummaries &&
                        budgetProfileSummaries.length > 0 && (
                          <option value="profile">From budget profile</option>
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
                                <option key={bp.id} value={String(bp.id)}>
                                  {bp.isActive ? "\u2713" : ""}
                                  {bp.name} (
                                  {formatCurrency(bp.columnTotals[0] ?? 0)}
                                  /mo)
                                </option>
                              ))}
                          </select>
                        </label>
                        {budgetForm.profileId &&
                          (() => {
                            const profile = budgetProfileSummaries.find(
                              (p) => String(p.id) === budgetForm.profileId,
                            );
                            if (!profile || profile.columnLabels.length <= 1)
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
                                  {profile.columnLabels.map((label, i) => (
                                    <option
                                      key={`col-${label}`}
                                      value={String(i)}
                                    >
                                      {label || `Col ${i + 1}`} (
                                      {formatCurrency(
                                        profile.columnTotals[i] ?? 0,
                                      )}
                                      /mo)
                                    </option>
                                  ))}
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
                    <span className="text-[10px] text-muted">Notes</span>
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
                    const colIdx = parseInt(budgetForm.profileColumn, 10) || 0;
                    const monthly = profile.columnTotals[colIdx] ?? 0;
                    const yr = parseInt(budgetForm.year);
                    const currentYear = new Date().getFullYear();
                    const yearsOut = !isNaN(yr)
                      ? Math.max(0, yr - currentYear)
                      : 0;
                    const inflationRate = s.engineSettings?.annualInflation
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
                            {yr} ({formatPercent(inflationRate)}/yr inflation ×{" "}
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
                      const budgetPersonId =
                        isPersonFiltered && enginePeople
                          ? (enginePeople.find((p) => p.id === personFilter)
                              ?.id ?? primaryPersonId)
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
                        const todayMonthly = profile.columnTotals[colIdx] ?? 0;
                        const currentYear = new Date().getFullYear();
                        const yearsOut = Math.max(0, yr - currentYear);
                        const inflationRate = s.engineSettings?.annualInflation
                          ? Number(s.engineSettings.annualInflation)
                          : 0;
                        resolvedValue =
                          todayMonthly * Math.pow(1 + inflationRate, yearsOut);
                        const colLabel = profile.columnLabels[colIdx] ?? "";
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
  );
}
