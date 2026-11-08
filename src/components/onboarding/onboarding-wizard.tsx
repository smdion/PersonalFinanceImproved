"use client";

import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Modal } from "@/components/ui/modal";
import { WelcomeStep } from "@/components/onboarding/welcome-step";
import { StepIndicator } from "@/components/onboarding/step-indicator";
import {
  type PersonDraft,
  type JobDraft,
  type AdminDraft,
  STEPS,
  type Step,
} from "./wizard-state";
import { AdminStep } from "./admin-step";
import { OidcStep } from "./oidc-step";
import { PeopleStep } from "./people-step";
import { IncomeStep } from "./income-step";
import { DoneStep } from "./done-step";
import { WizardNav } from "./wizard-nav";
import { restoreFromBackup } from "./wizard-saves";
import { wizardNavigation } from "./wizard-navigation";

interface OnboardingWizardProps {
  onComplete: () => void;
}

// --- Main wizard ---

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const [currentStep, setCurrentStep] = useState<Step>("Welcome");
  const [admin, setAdmin] = useState<AdminDraft>({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [people, setPeople] = useState<PersonDraft[]>([]);
  const [jobs, setJobs] = useState<JobDraft[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [taxDataSync, setTaxDataSync] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // The server says whether an admin is still needed: a reload or another
  // tab can't bring back an Admin step the server would refuse.
  const firstRun = trpc.settings.firstRunState.useQuery();
  const adminNeeded = firstRun.data?.adminNeeded === true;
  const createLocalAdmin = trpc.settings.createLocalAdmin.useMutation();
  const createPerson = trpc.settings.people.create.useMutation();
  const createJob = trpc.settings.jobs.create.useMutation();
  const updateSalaryProfile = trpc.salaryProfile.update.useMutation();
  const completeOnboarding = trpc.settings.completeOnboarding.useMutation();
  const setTaxDataSyncEnabled =
    trpc.settings.taxDataSync.setEnabled.useMutation();
  const syncAll = trpc.sync.syncAll.useMutation();
  const utils = trpc.useUtils();

  const handleRestore = () => {
    fileInputRef.current?.click();
  };

  const { handleFileSelected } = restoreFromBackup(
    setIsRestoring,
    setError,
    utils,
    syncAll,
  );

  const steps: readonly Step[] = adminNeeded
    ? STEPS
    : STEPS.filter((s) => s !== "Admin");
  const step = Math.max(steps.indexOf(currentStep), 0);

  /** Validate whether the current step allows proceeding */
  function isAdminValid(): boolean {
    return (
      admin.name.trim().length > 0 &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(admin.email) &&
      admin.password.length >= 12 &&
      admin.password === admin.confirmPassword
    );
  }

  const canGoNext =
    currentStep === "Welcome" ||
    currentStep === "Done" ||
    (currentStep === "Admin" && isAdminValid()) ||
    currentStep === "OIDC" ||
    (currentStep === "People" && people.length > 0) ||
    currentStep === "Income";

  /** Create the local admin account before advancing past the Admin step */
  const { goNext, goBack, skipIncome, skipOidc } = wizardNavigation(
    adminNeeded,
    setError,
    createLocalAdmin,
    admin,
    utils,
    firstRun,
    setCurrentStep,
    setIsSaving,
    people,
    createPerson,
    jobs,
    createJob,
    updateSalaryProfile,
    setTaxDataSyncEnabled,
    taxDataSync,
    completeOnboarding,
    onComplete,
    canGoNext,
    currentStep,
    setStepError,
    isAdminValid,
    steps,
    step,
  );

  return (
    <Modal
      onClose={() => {}}
      label="Set up Ledgr"
      closeOnEscape={false}
      closeOnBackdrop={false}
      layer="firstRun"
      className="bg-surface-primary border-default mx-4 max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border p-6 shadow-2xl sm:p-8"
    >
      <StepIndicator currentStep={step} steps={steps} />
      <div className="text-secondary mb-4 flex items-center justify-center gap-2 text-sm">
        Step {step + 1} of {steps.length}
      </div>

      {/* Hidden file input for restore */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleFileSelected}
      />

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

      {/* Navigation buttons (Welcome has its own CTA) */}
      <WizardNav
        currentStep={currentStep}
        goBack={goBack}
        step={step}
        isSaving={isSaving}
        skipOidc={skipOidc}
        skipIncome={skipIncome}
        goNext={goNext}
      />
    </Modal>
  );
}
