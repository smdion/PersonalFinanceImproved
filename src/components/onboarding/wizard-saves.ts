import {
  BLANK_SALARY_ENTRY,
  type SalaryEntry,
} from "@/lib/db/shapes/salary-entry-defaults";
import { type SetStateAction, type Dispatch } from "react";
import { trpc } from "@/lib/trpc";
import { calendarDateOf } from "@/lib/utils/calendar-date";
import { type PersonDraft, type JobDraft } from "./wizard-state";
import { taxFilingStatusSetting } from "@/lib/pure/tax/filing-status";
import type { FilingStatusKey } from "@/lib/config/filing-status";

/** Saves the household the wizard collected, then completes first run. */
export function finishSetup(
  setIsSaving: Dispatch<SetStateAction<boolean>>,
  setError: Dispatch<SetStateAction<string | null>>,
  people: PersonDraft[],
  createPerson: ReturnType<typeof trpc.people.create.useMutation>,
  jobs: JobDraft[],
  createJob: ReturnType<typeof trpc.jobs.create.useMutation>,
  utils: ReturnType<typeof trpc.useUtils>,
  updateSalaryProfile: ReturnType<typeof trpc.salaryProfile.update.useMutation>,
  setTaxDataSyncEnabled: ReturnType<
    typeof trpc.settings.taxDataSync.setEnabled.useMutation
  >,
  taxDataSync: boolean,
  completeOnboarding: ReturnType<
    typeof trpc.settings.completeOnboarding.useMutation
  >,
  onComplete: () => void,
) {
  const handleFinish = async () => {
    setIsSaving(true);
    setError(null);
    try {
      const createdPeopleIds: number[] = [];
      for (const person of people) {
        const created = await createPerson.mutateAsync(person);
        createdPeopleIds.push(created!.id);
      }

      // Jobs carry no salary: each one's goes into the Salary Profile below.
      const today = calendarDateOf(new Date());
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

      // Each new job's Salary Profile entry: no bonus, W-4 box = return status.
      if (Object.keys(jobEntries).length > 0) {
        const profiles = await utils.salaryProfile.list.fetch();
        const baseline = profiles[0];
        const settings = await utils.settings.appSettings.list.fetch();
        const filing: FilingStatusKey | null = taxFilingStatusSetting(
          settings.map((r) => ({ key: r.key, value: r.value })),
        );
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
              ...(filing ? { w4FilingStatus: filing } : {}),
            };
          }
          await updateSalaryProfile.mutateAsync({
            id: baseline.id,
            salaries,
          });
        }
      }

      await setTaxDataSyncEnabled.mutateAsync({ enabled: taxDataSync });
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

  return { handleFinish };
}

/** Restores a backup file picked on the Welcome step, then reloads the page. */
export function restoreFromBackup(
  setIsRestoring: Dispatch<SetStateAction<boolean>>,
  setError: Dispatch<SetStateAction<string | null>>,
  utils: ReturnType<typeof trpc.useUtils>,
  syncAll: ReturnType<typeof trpc.sync.syncAll.useMutation>,
) {
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

      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to restore backup");
      setIsRestoring(false);
    }
  };

  return { handleFileSelected };
}
