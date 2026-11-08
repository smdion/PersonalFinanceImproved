import { WelcomeStep } from "@/components/onboarding/welcome-step";
import type { PersonDraft, JobDraft, AdminDraft, Step } from "./wizard-state";
import { AdminStep } from "./admin-step";
import { OidcStep } from "./oidc-step";
import { PeopleStep } from "./people-step";
import { IncomeStep } from "./income-step";
import { DoneStep } from "./done-step";
import type { Dispatch, SetStateAction } from "react";
import { StepIndicator } from "@/components/onboarding/step-indicator";

export type WizardBodyProps = {
  admin: AdminDraft;
  currentStep: Step;
  error: string | null;
  goNext: () => Promise<void>;
  handleRestore: () => void;
  isRestoring: boolean;
  isSaving: boolean;
  jobs: JobDraft[];
  people: PersonDraft[];
  setAdmin: Dispatch<SetStateAction<AdminDraft>>;
  setJobs: Dispatch<SetStateAction<JobDraft[]>>;
  setPeople: Dispatch<SetStateAction<PersonDraft[]>>;
  setTaxDataSync: Dispatch<SetStateAction<boolean>>;
  stepError: string | null;
  taxDataSync: boolean;
};

/** The current step's content and the wizard's messages. */
export function WizardBody({
  admin,
  currentStep,
  error,
  goNext,
  handleRestore,
  isRestoring,
  isSaving,
  jobs,
  people,
  setAdmin,
  setJobs,
  setPeople,
  setTaxDataSync,
  stepError,
  taxDataSync,
}: WizardBodyProps) {
  return (
    <>
      {/* Step content */}
      {currentStep === "Welcome" && (
        <WelcomeStep onNext={goNext} onRestore={handleRestore} />
      )}
      {currentStep === "Admin" && (
        <AdminStep admin={admin} setAdmin={setAdmin} />
      )}
      {currentStep === "OIDC" && <OidcStep />}
      {currentStep === "People" && (
        <PeopleStep people={people} setPeople={setPeople} />
      )}
      {currentStep === "Income" && (
        <IncomeStep people={people} jobs={jobs} setJobs={setJobs} />
      )}
      {currentStep === "Done" && (
        <DoneStep
          isSaving={isSaving}
          taxDataSync={taxDataSync}
          setTaxDataSync={setTaxDataSync}
        />
      )}

      {/* Restoring overlay */}
      {isRestoring && (
        <div className="flex flex-col items-center justify-center gap-4 py-8 text-center">
          <div className="text-primary text-lg font-medium">
            Restoring backup...
          </div>
          <p className="text-muted text-sm">
            This may take a moment. Please don&apos;t close this page.
          </p>
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {stepError && (
        <div
          className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700"
          role="alert"
        >
          {stepError}
        </div>
      )}
    </>
  );
}

export type WizardProgressProps = {
  step: number;
  steps: readonly Step[];
};

/** The step dots and the step count. */
export function WizardProgress({ step, steps }: WizardProgressProps) {
  return (
    <>
      <StepIndicator currentStep={step} steps={steps} />
      <div className="text-secondary mb-4 flex items-center justify-center gap-2 text-sm">
        Step {step + 1} of {steps.length}
      </div>
    </>
  );
}
