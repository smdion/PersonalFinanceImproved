"use client";

/** Profile/column/override selectors for current + relocation budgets, plus
 *  contribution profile selectors. Extracted from tools/page.tsx during the
 *  v0.5.2 file-split refactor. Stateless — all state flows via props.
 */

import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency } from "@/lib/utils/format";
import type {
  RelocationBudgetInfo,
  RelocationContribProfile,
  ContribProfileListItem,
} from "./types";

type Props = {
  budgetInfo: RelocationBudgetInfo;

  // Current budget
  effectiveCurrentProfileId: number;
  setRelocCurrentProfileId: (id: number) => void;
  relocCurrentCol: number;
  setRelocCurrentCol: (col: number) => void;
  relocCurrentOverride: string;
  setRelocCurrentOverride: (value: string) => void;

  // Target (relocation) budget
  effectiveTargetProfileId: number;
  setRelocTargetProfileId: (id: number) => void;
  relocTargetCol: number;
  setRelocTargetCol: (col: number) => void;
  relocTargetOverride: string;
  setRelocTargetOverride: (value: string) => void;

  // Contribution profile pickers
  contribProfiles: ContribProfileListItem[];
  effectiveCurrentContribProfileId: number | null;
  setRelocCurrentContribProfileId: (id: number) => void;
  effectiveTargetContribProfileId: number | null;
  setRelocTargetContribProfileId: (id: number) => void;

  currentContribProfile: RelocationContribProfile | null | undefined;
  relocationContribProfile: RelocationContribProfile | null | undefined;
};

export function RelocationBudgetSelectors({
  budgetInfo,
  effectiveCurrentProfileId,
  setRelocCurrentProfileId,
  relocCurrentCol,
  setRelocCurrentCol,
  relocCurrentOverride,
  setRelocCurrentOverride,
  effectiveTargetProfileId,
  setRelocTargetProfileId,
  relocTargetCol,
  setRelocTargetCol,
  relocTargetOverride,
  setRelocTargetOverride,
  contribProfiles,
  effectiveCurrentContribProfileId,
  setRelocCurrentContribProfileId,
  effectiveTargetContribProfileId,
  setRelocTargetContribProfileId,
  currentContribProfile,
  relocationContribProfile,
}: Props) {
  const currentProf = budgetInfo.profiles.find(
    (p) => p.id === effectiveCurrentProfileId,
  );
  const targetProf = budgetInfo.profiles.find(
    (p) => p.id === effectiveTargetProfileId,
  );
  const currentMonths = currentProf?.columnMonths ?? null;
  const targetMonths = targetProf?.columnMonths ?? null;
  const currentWeighted = currentProf?.weightedAnnualTotal ?? null;
  const targetWeighted = targetProf?.weightedAnnualTotal ?? null;

  return (
    <>
      {/* Profile + Column selectors */}
      <div className="grid grid-cols-[1fr_auto_1fr] gap-4 items-start text-sm">
        {/* Current Budget */}
        <div>
          <label className="block text-muted mb-1">
            Current Budget
            <HelpTip text="Budget profile used for your current living expenses. When a profile has month assignments, the weighted average is used automatically." />
          </label>
          <div className="flex flex-col gap-1">
            <select
              className="border rounded px-2 py-1 text-sm"
              value={effectiveCurrentProfileId}
              onChange={(e) => {
                setRelocCurrentProfileId(Number(e.target.value));
                setRelocCurrentCol(0);
              }}
            >
              {budgetInfo.profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {currentMonths ? (
              <span className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">
                Weighted: {formatCurrency((currentWeighted ?? 0) / 12)}/mo
                <span className="text-[10px] text-faint ml-1">
                  (
                  {currentMonths
                    .map(
                      (m, i) =>
                        `${m}mo ${(currentProf?.columnLabels ?? [])[i] ?? ""}`,
                    )
                    .join(" +")}
                  )
                </span>
              </span>
            ) : (currentProf?.columnLabels ?? []).length >= 2 ? (
              <select
                className="border rounded px-2 py-1 text-sm"
                value={relocCurrentCol}
                onChange={(e) => setRelocCurrentCol(Number(e.target.value))}
              >
                {(currentProf?.columnLabels ?? []).map((label, i) => (
                  <option key={label} value={i}>
                    {label} (
                    {formatCurrency((currentProf?.columnTotals ?? [])[i] ?? 0)}
                    /mo)
                  </option>
                ))}
              </select>
            ) : null}
            {/* Override */}
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-faint">Override:</span>
              <input
                type="number"
                className="border rounded px-2 py-0.5 text-xs w-24"
                placeholder="$/mo"
                value={relocCurrentOverride}
                onChange={(e) => setRelocCurrentOverride(e.target.value)}
              />
              {relocCurrentOverride && (
                <button
                  className="text-[10px] text-red-400 hover:text-red-600"
                  onClick={() => setRelocCurrentOverride("")}
                >
                  clear
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="text-faint self-center pt-6">→</div>

        {/* Relocation Budget */}
        <div>
          <label className="block text-muted mb-1">
            Relocation Budget
            <HelpTip text="Budget profile for projected expenses after relocating. Use the override to enter a custom monthly amount." />
          </label>
          <div className="flex flex-col gap-1">
            <select
              className="border rounded px-2 py-1 text-sm"
              value={effectiveTargetProfileId}
              onChange={(e) => {
                setRelocTargetProfileId(Number(e.target.value));
                setRelocTargetCol(0);
              }}
            >
              {budgetInfo.profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {targetMonths ? (
              <span className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">
                Weighted: {formatCurrency((targetWeighted ?? 0) / 12)}/mo
                <span className="text-[10px] text-faint ml-1">
                  (
                  {targetMonths
                    .map(
                      (m, i) =>
                        `${m}mo ${(targetProf?.columnLabels ?? [])[i] ?? ""}`,
                    )
                    .join(" +")}
                  )
                </span>
              </span>
            ) : (targetProf?.columnLabels ?? []).length >= 2 ? (
              <select
                className="border rounded px-2 py-1 text-sm"
                value={relocTargetCol}
                onChange={(e) => setRelocTargetCol(Number(e.target.value))}
              >
                {(targetProf?.columnLabels ?? []).map((label, i) => (
                  <option key={label} value={i}>
                    {label} (
                    {formatCurrency((targetProf?.columnTotals ?? [])[i] ?? 0)}
                    /mo)
                  </option>
                ))}
              </select>
            ) : null}
            {/* Override */}
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-faint">Override:</span>
              <input
                type="number"
                className="border rounded px-2 py-0.5 text-xs w-24"
                placeholder="$/mo"
                value={relocTargetOverride}
                onChange={(e) => setRelocTargetOverride(e.target.value)}
              />
              {relocTargetOverride && (
                <button
                  className="text-[10px] text-red-400 hover:text-red-600"
                  onClick={() => setRelocTargetOverride("")}
                >
                  clear
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Contribution profile selectors */}
      {contribProfiles.length > 0 && (
        <div className="grid grid-cols-[1fr_auto_1fr] gap-4 items-start text-sm">
          <div>
            <label className="block text-muted mb-1">
              Current Contributions
              <HelpTip text="Salary and contribution profile for your current scenario. Managed on the Budget page." />
            </label>
            <select
              className="border rounded px-2 py-1 text-sm w-full"
              value={effectiveCurrentContribProfileId ?? ""}
              onChange={(e) =>
                setRelocCurrentContribProfileId(Number(e.target.value))
              }
            >
              {contribProfiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {currentContribProfile && (
              <div className="mt-1 text-[10px] text-faint flex gap-3">
                <span>
                  Salary: {formatCurrency(currentContribProfile.combinedSalary)}
                </span>
                <span>
                  Contributions:{" "}
                  {formatCurrency(currentContribProfile.annualContributions)}
                  /yr
                </span>
                <span>
                  Match: {formatCurrency(currentContribProfile.employerMatch)}
                  /yr
                </span>
              </div>
            )}
          </div>
          <div className="text-faint self-center pt-6">→</div>
          <div>
            <label className="block text-muted mb-1">
              Relocation Contributions
              <HelpTip text="Salary and contribution profile for the relocation scenario. Create profiles on the Budget page." />
            </label>
            <select
              className="border rounded px-2 py-1 text-sm w-full"
              value={effectiveTargetContribProfileId ?? ""}
              onChange={(e) =>
                setRelocTargetContribProfileId(Number(e.target.value))
              }
            >
              {contribProfiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {relocationContribProfile && (
              <div className="mt-1 text-[10px] text-faint flex gap-3">
                <span>
                  Salary:{" "}
                  {formatCurrency(relocationContribProfile.combinedSalary)}
                </span>
                <span>
                  Contributions:{" "}
                  {formatCurrency(relocationContribProfile.annualContributions)}
                  /yr
                </span>
                <span>
                  Match:{" "}
                  {formatCurrency(relocationContribProfile.employerMatch)}
                  /yr
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
