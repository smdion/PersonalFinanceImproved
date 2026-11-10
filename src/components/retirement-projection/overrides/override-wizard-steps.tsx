import type { Dispatch, JSX, SetStateAction } from "react";
import { type OverrideType, OVERRIDE_OPTIONS } from "./override-options";

export type WizardProgressProps = {
  editingOverride: {
    phase: "pre" | "post" | "life";
    index: number;
    deleteFirst: () => void;
    initialValue?: string;
  } | null;
  selectedYear: string;
  wizardStep: "year" | "type" | "fields";
};

export function WizardProgress({
  editingOverride,
  selectedYear,
  wizardStep,
}: WizardProgressProps) {
  return (
    <>
      {editingOverride && (
        <div className="text-caption font-medium text-indigo-600">
          Editing the change for {selectedYear}
        </div>
      )}
      <div className="text-caption text-muted flex items-center gap-2">
        <span
          className={
            wizardStep === "year" ? "font-semibold text-indigo-600" : ""
          }
        >
          1. Year
        </span>
        <span>→</span>
        <span
          className={
            wizardStep === "type" ? "font-semibold text-indigo-600" : ""
          }
        >
          2. What to change
        </span>
        <span>→</span>
        <span
          className={
            wizardStep === "fields" ? "font-semibold text-indigo-600" : ""
          }
        >
          3. New value
        </span>
      </div>
    </>
  );
}

export type WizardYearStepProps = {
  isPostRetirement: boolean;
  retYear: number | null;
  selectedYear: string;
  setSelectedYear: Dispatch<SetStateAction<string>>;
  setWizardStep: Dispatch<SetStateAction<"type" | "year" | "fields">>;
  wizardStep: "type" | "year" | "fields";
};

export function WizardYearStep({
  isPostRetirement,
  retYear,
  selectedYear,
  setSelectedYear,
  setWizardStep,
  wizardStep,
}: WizardYearStepProps) {
  return (
    <>
      {wizardStep === "year" && (
        <div className="flex items-end gap-3">
          <label className="block">
            <span className="text-muted text-xs">Starting Year</span>
            <input
              type="number"
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="border-strong mt-0.5 block w-24 rounded border px-2 py-1.5 text-sm"
            />
          </label>
          {retYear && (
            <span className="text-caption text-faint pb-2">
              {isPostRetirement
                ? "Post-retirement (withdrawal phase)"
                : `Pre-retirement (saving phase, retires ${retYear})`}
            </span>
          )}
          <button
            type="button"
            onClick={() => setWizardStep("type")}
            className="rounded bg-indigo-600 px-3 py-1.5 text-xs text-white hover:bg-indigo-700"
          >
            Next
          </button>
        </div>
      )}
    </>
  );
}

export type WizardTypeStepProps = {
  availableOptions: {
    key: OverrideType;
    label: string;
    description: string;
    icon: string;
    phase: "any" | "pre" | "post";
  }[];
  isPostRetirement: boolean;
  selectedYear: string;
  setSelectedType: Dispatch<SetStateAction<OverrideType | null>>;
  setWizardStep: Dispatch<SetStateAction<"type" | "year" | "fields">>;
  wizardStep: "type" | "year" | "fields";
};

export function WizardTypeStep({
  availableOptions,
  isPostRetirement,
  selectedYear,
  setSelectedType,
  setWizardStep,
  wizardStep,
}: WizardTypeStepProps) {
  return (
    <>
      {wizardStep === "type" && (
        <div>
          <div className="mb-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setWizardStep("year")}
              className="text-caption text-indigo-600 hover:underline"
            >
              ← Back
            </button>
            <span className="text-muted text-xs">
              Year {selectedYear} —{" "}
              {isPostRetirement ? "post-retirement" : "pre-retirement"}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {availableOptions.map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => {
                  setSelectedType(opt.key);
                  setWizardStep("fields");
                }}
                className="border-subtle rounded-lg border p-2.5 text-left transition-colors hover:border-indigo-400 hover:bg-indigo-50"
              >
                <div className="text-sm">
                  {opt.icon} {opt.label}
                </div>
                <div className="text-caption text-faint mt-0.5">
                  {opt.description}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

export type WizardFieldsStepProps = {
  renderFields: () => JSX.Element | null;
  selectedType: OverrideType | null;
  selectedYear: string;
  setWizardStep: Dispatch<SetStateAction<"year" | "type" | "fields">>;
  wizardStep: "year" | "type" | "fields";
};

export function WizardFieldsStep({
  renderFields,
  selectedType,
  selectedYear,
  setWizardStep,
  wizardStep,
}: WizardFieldsStepProps) {
  return (
    <>
      {wizardStep === "fields" && selectedType && (
        <div>
          <div className="mb-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setWizardStep("type")}
              className="text-caption text-indigo-600 hover:underline"
            >
              ← Back
            </button>
            <span className="text-muted text-xs">
              Year {selectedYear} —{" "}
              {OVERRIDE_OPTIONS.find((o) => o.key === selectedType)?.label}
            </span>
          </div>
          {renderFields()}
        </div>
      )}
    </>
  );
}
