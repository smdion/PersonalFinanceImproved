"use client";

import {
  BLANK_SALARY_ENTRY,
  type SalaryEntry,
} from "@/lib/db/salary-entry-defaults";
import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Modal } from "@/components/ui/modal";
import { WelcomeStep } from "@/components/onboarding/welcome-step";
import { StepIndicator } from "@/components/onboarding/step-indicator";
import { localDateStr } from "@/lib/utils/date";
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

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setIsRestoring(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/versions/import", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Import failed");
      }

      // Sync budget API after restore (silently — may not be configured)
      try {
        const activeService = await utils.sync.getActiveBudgetApi.fetch();
        if (activeService !== "none") {
          await syncAll.mutateAsync({ service: activeService });
        }
      } catch {
        // No API connection configured or sync failed — not critical
      }

      // Full page reload to pick up all imported data
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to restore backup");
      setIsRestoring(false);
    }
  };

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
  const handleAdminCreate = async () => {
    if (!adminNeeded) return true;
    setError(null);
    try {
      await createLocalAdmin.mutateAsync({
        name: admin.name.trim(),
        email: admin.email.trim(),
        password: admin.password,
      });
      await utils.settings.firstRunState.invalidate();
      return true;
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to create admin account.",
      );
      // Refused because an admin exists already: move past the step.
      const { data } = await firstRun.refetch();
      if (data?.adminNeeded === false) {
        setError(null);
        setCurrentStep("OIDC");
      }
      return false;
    }
  };

  const handleFinish = async () => {
    setIsSaving(true);
    setError(null);
    try {
      // Create all people and collect their IDs
      const createdPeopleIds: number[] = [];
      for (const person of people) {
        const created = await createPerson.mutateAsync(person);
        createdPeopleIds.push(created!.id);
      }

      // Create all jobs, mapping personIndex to the real person ID. A job
      // carries no salary of its own — each one's annualSalary from the
      // Income step goes into the household's Salary Profile below instead.
      const today = localDateStr();
      const jobEntries: Record<
        string,
        { salary: number; payPeriod: JobDraft["payPeriod"] }
      > = {};
      for (const job of jobs) {
        const personId = createdPeopleIds[job.personIndex];
        if (personId === undefined) continue;
        const created = await createJob.mutateAsync({
          personId,
          employerName: job.employerName,
          startDate: today,
        });
        if (created) {
          jobEntries[String(created.id)] = {
            salary: Number(job.annualSalary),
            payPeriod: job.payPeriod,
          };
        }
      }

      // Give each new job a complete entry in the baseline Salary Profile
      // (migrations always leave exactly one active profile behind, even on
      // a fresh install) — no bonus assumed, plain on-target terms.
      if (Object.keys(jobEntries).length > 0) {
        const profiles = await utils.salaryProfile.list.fetch();
        const baseline = profiles[0];
        if (baseline) {
          const salaries = { ...baseline.salaries } as Record<
            string,
            SalaryEntry
          >;
          for (const [jobId, entry] of Object.entries(jobEntries)) {
            salaries[jobId] = {
              ...BLANK_SALARY_ENTRY,
              salary: entry.salary,
              payPeriod: entry.payPeriod,
            };
          }
          await updateSalaryProfile.mutateAsync({
            id: baseline.id,
            salaries,
          });
        }
      }

      await setTaxDataSyncEnabled.mutateAsync({ enabled: taxDataSync });
      // Mark onboarding complete
      await completeOnboarding.mutateAsync();
      onComplete();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Something went wrong. Please try again.",
      );
      setIsSaving(false);
    }
  };

  const goNext = async () => {
    // Which steps there are isn't known until the server answers.
    if (firstRun.isPending) return;
    if (!canGoNext) {
      if (currentStep === "People" && people.length === 0) {
        setStepError("Add at least one household member to continue");
      }
      if (currentStep === "Admin" && !isAdminValid()) {
        setStepError("Complete all fields to continue");
      }
      return;
    }
    setStepError(null);

    // Admin step: create the account before advancing
    if (currentStep === "Admin") {
      const ok = await handleAdminCreate();
      if (!ok) return;
      setCurrentStep("OIDC");
      return;
    }

    if (currentStep === "Done") {
      handleFinish();
      return;
    }
    setCurrentStep(steps[step + 1] ?? "Done");
  };

  const goBack = () => {
    setStepError(null);
    setCurrentStep(steps[step - 1] ?? "Welcome");
  };

  const skipIncome = () => setCurrentStep("Done");
  const skipOidc = () => setCurrentStep("People");

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
