import type { UseTRPCQueryResult } from "@trpc/react-query/shared";
import type { trpc, RouterError, RouterOutputs } from "@/lib/trpc";
import type { PersonDraft, JobDraft, AdminDraft, Step } from "./wizard-state";
import { finishSetup } from "./wizard-saves";
import type { Dispatch, SetStateAction } from "react";

/** The wizard's Next, Back and skip actions; Next on Admin and Done saves. */
export function wizardNavigation(
  adminNeeded: boolean,
  setError: Dispatch<SetStateAction<string | null>>,
  createLocalAdmin: ReturnType<
    typeof trpc.settings.createLocalAdmin.useMutation
  >,
  admin: AdminDraft,
  utils: ReturnType<typeof trpc.useUtils>,
  firstRun: UseTRPCQueryResult<
    RouterOutputs["settings"]["firstRunState"],
    RouterError
  >,
  setCurrentStep: Dispatch<SetStateAction<Step>>,
  setIsSaving: Dispatch<SetStateAction<boolean>>,
  people: PersonDraft[],
  createPerson: ReturnType<typeof trpc.settings.people.create.useMutation>,
  jobs: JobDraft[],
  createJob: ReturnType<typeof trpc.settings.jobs.create.useMutation>,
  updateSalaryProfile: ReturnType<typeof trpc.salaryProfile.update.useMutation>,
  setTaxDataSyncEnabled: ReturnType<
    typeof trpc.settings.taxDataSync.setEnabled.useMutation
  >,
  taxDataSync: boolean,
  completeOnboarding: ReturnType<
    typeof trpc.settings.completeOnboarding.useMutation
  >,
  onComplete: () => void,
  canGoNext: boolean,
  currentStep: Step,
  setStepError: Dispatch<SetStateAction<string | null>>,
  isAdminValid: () => boolean,
  steps: readonly Step[],
  step: number,
) {
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

  const { handleFinish } = finishSetup(
    setIsSaving,
    setError,
    people,
    createPerson,
    jobs,
    createJob,
    utils,
    updateSalaryProfile,
    setTaxDataSyncEnabled,
    taxDataSync,
    completeOnboarding,
    onComplete,
  );

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

  return { goNext, goBack, skipIncome, skipOidc };
}
