import { useState } from "react";
import { formatCurrency } from "@/lib/utils/format";

/** Simple single-value form used by most override types. */
export function SimpleNumberForm({
  label,
  placeholder,
  step,
  isDollar: _isDollar,
  initialValue,
  onSubmit,
}: {
  label: string;
  placeholder: string;
  step?: number;
  isDollar?: boolean;
  initialValue?: string;
  onSubmit: (value: number, notes: string) => void;
}) {
  const [value, setValue] = useState(initialValue ?? "");
  const [notes, setNotes] = useState("");

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="block">
        <span className="text-muted text-xs">{label}</span>
        <input
          type="number"
          min={0}
          step={step ?? 1}
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="border-strong mt-0.5 block w-40 rounded border px-2 py-1.5 text-sm"
        />
      </label>
      <label className="block min-w-[120px] flex-1">
        <span className="text-muted text-xs">Notes (optional)</span>
        <input
          type="text"
          placeholder="Reason for change"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="border-strong mt-0.5 block w-full rounded border px-2 py-1.5 text-sm"
        />
      </label>
      <button
        type="button"
        onClick={() => {
          const num = parseFloat(value);
          if (isNaN(num) || num <= 0) return;
          onSubmit(num, notes);
        }}
        className="rounded bg-indigo-600 px-4 py-1.5 text-xs text-white hover:bg-indigo-700"
      >
        Save
      </button>
    </div>
  );
}

/** Routing mode selector form. */
export function RoutingForm({
  isPostRetirement,
  onSubmit,
}: {
  isPostRetirement: boolean;
  onSubmit: (mode: string, notes: string) => void;
}) {
  const [mode, setMode] = useState<
    "bracket_filling" | "waterfall" | "percentage"
  >(isPostRetirement ? "bracket_filling" : "waterfall");
  const [notes, setNotes] = useState("");

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="block">
        <span className="text-muted text-xs">Routing Mode</span>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as typeof mode)}
          className="border-strong mt-0.5 block w-48 rounded border px-2 py-1.5 text-sm"
        >
          {isPostRetirement && (
            <option value="bracket_filling">
              Bracket Filling (tax-optimized)
            </option>
          )}
          <option value="waterfall">Waterfall (priority order)</option>
          <option value="percentage">Percentage (split by %)</option>
        </select>
      </label>
      <label className="block min-w-[120px] flex-1">
        <span className="text-muted text-xs">Notes (optional)</span>
        <input
          type="text"
          placeholder="Reason for change"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="border-strong mt-0.5 block w-full rounded border px-2 py-1.5 text-sm"
        />
      </label>
      <button
        type="button"
        onClick={() => onSubmit(mode, notes)}
        className="rounded bg-indigo-600 px-4 py-1.5 text-xs text-white hover:bg-indigo-700"
      >
        Save
      </button>
    </div>
  );
}

/** Salary override form — "From contribution profile" or custom salary amount. */
export function SalaryOverrideForm({
  contributionProfiles,
  initialValue,
  onSubmit,
}: {
  year: number;
  contributionProfiles: {
    id: number;
    name: string;
    summary?: { combinedSalary: number };
  }[];
  personId: number;
  initialValue?: string;
  onSubmit: (salary: number, profileId: number | null, notes: string) => void;
}) {
  const [source, setSource] = useState<"custom" | "profile">(
    contributionProfiles.length > 0 ? "profile" : "custom",
  );
  const [profileId, setProfileId] = useState(contributionProfiles[0]?.id ?? 0);
  const [customValue, setCustomValue] = useState(initialValue ?? "");
  const [notes, setNotes] = useState("");

  const selectedProfile = contributionProfiles.find((p) => p.id === profileId);
  const resolvedSalary =
    source === "profile" && selectedProfile?.summary
      ? selectedProfile.summary.combinedSalary
      : parseFloat(customValue) || 0;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        {contributionProfiles.length > 0 && (
          <label className="block">
            <span className="text-muted text-xs">Source</span>
            <select
              value={source}
              onChange={(e) =>
                setSource(e.target.value as "custom" | "profile")
              }
              className="border-strong mt-0.5 block w-48 rounded border px-2 py-1.5 text-sm"
            >
              <option value="profile">From contribution profile</option>
              <option value="custom">Custom salary amount</option>
            </select>
          </label>
        )}
        {source === "profile" ? (
          <label className="block min-w-[200px] flex-1">
            <span className="text-muted text-xs">Contribution Profile</span>
            <select
              value={String(profileId)}
              onChange={(e) => setProfileId(Number(e.target.value))}
              className="border-strong mt-0.5 block w-full rounded border px-2 py-1.5 text-sm"
            >
              {contributionProfiles.map((cp) => (
                <option key={cp.id} value={String(cp.id)}>
                  {cp.name}
                  {cp.summary
                    ? ` (${formatCurrency(cp.summary.combinedSalary)}/yr)`
                    : ""}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="block">
            <span className="text-muted text-xs">Annual Salary ($)</span>
            <input
              type="number"
              min={0}
              placeholder="150000"
              value={customValue}
              onChange={(e) => setCustomValue(e.target.value)}
              className="border-strong mt-0.5 block w-40 rounded border px-2 py-1.5 text-sm"
            />
          </label>
        )}
        <label className="block min-w-[120px] flex-1">
          <span className="text-muted text-xs">Notes (optional)</span>
          <input
            type="text"
            placeholder="New job, promotion, etc."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="border-strong mt-0.5 block w-full rounded border px-2 py-1.5 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={() => {
            if (resolvedSalary <= 0) return;
            const profileNote =
              source === "profile" && selectedProfile
                ? `Profile: ${selectedProfile.name}${notes ? ` — ${notes}` : ""}`
                : notes;
            onSubmit(
              resolvedSalary,
              source === "profile" ? profileId : null,
              profileNote,
            );
          }}
          className="rounded bg-indigo-600 px-4 py-1.5 text-xs text-white hover:bg-indigo-700"
        >
          Save
        </button>
      </div>
      {source === "profile" && selectedProfile?.summary && (
        <p className="text-caption text-faint">
          Switches to {selectedProfile.name} contribution structure with{" "}
          {formatCurrency(selectedProfile.summary.combinedSalary)}/yr salary. To
          edit salary independently, use &quot;Custom salary amount&quot;
          instead.
        </p>
      )}
    </div>
  );
}

/** Budget override form — "From budget profile" or custom amount. */
export function BudgetOverrideForm({
  budgetProfiles,
  initialValue,
  onSubmit,
}: {
  year: number;
  budgetProfiles: {
    id: number;
    name: string;
    isActive?: boolean;
    columnTotals: number[];
    columnLabels: string[];
  }[];
  personId: number;
  initialValue?: string;
  onSubmit: (annualBudget: number, notes: string) => void;
}) {
  const [source, setSource] = useState<"custom" | "profile">(
    budgetProfiles.length > 0 ? "profile" : "custom",
  );
  const [profileId, setProfileId] = useState(
    budgetProfiles.find((p) => p.isActive)?.id ?? budgetProfiles[0]?.id ?? 0,
  );
  const [columnIndex, setColumnIndex] = useState(0);
  const [customValue, setCustomValue] = useState(initialValue ?? "");
  const [notes, setNotes] = useState("");

  const selectedProfile = budgetProfiles.find((p) => p.id === profileId);
  const monthlyBudget =
    source === "profile" && selectedProfile
      ? (selectedProfile.columnTotals[columnIndex] ?? 0)
      : (parseFloat(customValue) || 0) / 12;
  const annualBudget = monthlyBudget * 12;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        {budgetProfiles.length > 0 && (
          <label className="block">
            <span className="text-muted text-xs">Source</span>
            <select
              value={source}
              onChange={(e) =>
                setSource(e.target.value as "custom" | "profile")
              }
              className="border-strong mt-0.5 block w-40 rounded border px-2 py-1.5 text-sm"
            >
              <option value="profile">From budget profile</option>
              <option value="custom">Custom amount</option>
            </select>
          </label>
        )}
        {source === "profile" ? (
          <>
            <label className="block min-w-[180px] flex-1">
              <span className="text-muted text-xs">Budget Profile</span>
              <select
                value={String(profileId)}
                onChange={(e) => {
                  setProfileId(Number(e.target.value));
                  setColumnIndex(0);
                }}
                className="border-strong mt-0.5 block w-full rounded border px-2 py-1.5 text-sm"
              >
                {budgetProfiles.map((bp) => (
                  <option key={bp.id} value={String(bp.id)}>
                    {bp.isActive ? "\u2713 " : ""}
                    {bp.name} ({formatCurrency(bp.columnTotals[0] ?? 0)}/mo)
                  </option>
                ))}
              </select>
            </label>
            {selectedProfile && selectedProfile.columnLabels.length > 1 && (
              <label className="block">
                <span className="text-muted text-xs">Column</span>
                <select
                  value={String(columnIndex)}
                  onChange={(e) => setColumnIndex(Number(e.target.value))}
                  className="border-strong mt-0.5 block w-32 rounded border px-2 py-1.5 text-sm"
                >
                  {selectedProfile.columnLabels.map((label, colIndex) => (
                    // eslint-disable-next-line react/no-array-index-key -- column labels can repeat; index is the only stable key
                    <option key={colIndex} value={String(colIndex)}>
                      {label} (
                      {formatCurrency(
                        selectedProfile.columnTotals[colIndex] ?? 0,
                      )}
                      /mo)
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        ) : (
          <label className="block">
            <span className="text-muted text-xs">Annual Budget ($)</span>
            <input
              type="number"
              min={0}
              placeholder="90000"
              value={customValue}
              onChange={(e) => setCustomValue(e.target.value)}
              className="border-strong mt-0.5 block w-40 rounded border px-2 py-1.5 text-sm"
            />
          </label>
        )}
        <label className="block min-w-[120px] flex-1">
          <span className="text-muted text-xs">Notes (optional)</span>
          <input
            type="text"
            placeholder="Reason for change"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="border-strong mt-0.5 block w-full rounded border px-2 py-1.5 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={() => {
            if (annualBudget <= 0) return;
            const profileNote =
              source === "profile" && selectedProfile
                ? `Budget: ${selectedProfile.name} (${selectedProfile.columnLabels[columnIndex] ?? "Standard"}) — ${formatCurrency(monthlyBudget)}/mo${notes ? ` — ${notes}` : ""}`
                : notes;
            onSubmit(annualBudget, profileNote);
          }}
          className="rounded bg-indigo-600 px-4 py-1.5 text-xs text-white hover:bg-indigo-700"
        >
          Save
        </button>
      </div>
      {source === "profile" && selectedProfile && (
        <p className="text-caption text-faint">
          {selectedProfile.name} (
          {selectedProfile.columnLabels[columnIndex] ?? "Standard"}):{" "}
          {formatCurrency(monthlyBudget)}/mo · {formatCurrency(annualBudget)}/yr
        </p>
      )}
    </div>
  );
}
