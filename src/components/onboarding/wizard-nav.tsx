/** The first-run wizard's Back, skip and Next buttons. */
import type { Step } from "./wizard-state";

export type WizardNavProps = {
  currentStep: Step;
  goBack: () => void;
  step: number;
  isSaving: boolean;
  skipOidc: () => void;
  skipIncome: () => void;
  goNext: () => void;
};

/** Back, the step's skip, and Next (Welcome has its own buttons). */
export function WizardNav({
  currentStep,
  goBack,
  step,
  isSaving,
  skipOidc,
  skipIncome,
  goNext,
}: WizardNavProps) {
  return (
    <>
      {currentStep !== "Welcome" && (
        <div className="border-default mt-8 flex items-center justify-between border-t pt-4">
          <button
            onClick={goBack}
            disabled={step === 0 || isSaving}
            className="text-muted hover:text-primary hover:bg-surface-elevated rounded-lg px-4 py-2 transition-colors disabled:cursor-not-allowed disabled:opacity-30"
          >
            Back
          </button>
          <div className="flex gap-3">
            {currentStep === "OIDC" && (
              <button
                onClick={skipOidc}
                className="text-muted hover:text-primary hover:bg-surface-elevated rounded-lg px-4 py-2 transition-colors"
              >
                Configure Later
              </button>
            )}
            {currentStep === "Income" && (
              <button
                onClick={skipIncome}
                className="text-muted hover:text-primary hover:bg-surface-elevated rounded-lg px-4 py-2 transition-colors"
              >
                Skip
              </button>
            )}
            <button
              onClick={goNext}
              disabled={isSaving}
              className="rounded-lg bg-blue-600 px-6 py-2 font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {currentStep === "Done"
                ? isSaving
                  ? "Saving..."
                  : "Go to Dashboard"
                : "Next"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
