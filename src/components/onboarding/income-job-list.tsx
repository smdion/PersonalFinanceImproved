import { formatCurrency } from "@/lib/utils/format";
import type { PersonDraft, JobDraft } from "./wizard-state";

export type IncomeJobListProps = {
  jobs: JobDraft[];
  people: PersonDraft[];
  removeJob: (index: number) => void;
};

/** The jobs added so far, each with its Remove button. */
export function IncomeJobList({ jobs, people, removeJob }: IncomeJobListProps) {
  return (
    <>
      {jobs.length > 0 && (
        <div className="space-y-2">
          {jobs.map((job, i) => (
            <div
              key={`${job.personIndex}-${job.employerName}`}
              className="bg-surface-primary border-default flex items-center justify-between rounded-lg border px-4 py-3"
            >
              <div>
                <span className="text-primary font-medium">
                  {job.employerName}
                </span>
                <span className="text-muted ml-2 text-sm">
                  ({people[job.personIndex]?.name}) --{" "}
                  {formatCurrency(Number(job.annualSalary))}/{job.payPeriod}
                </span>
              </div>
              <button
                onClick={() => removeJob(i)}
                className="text-sm text-red-500 hover:text-red-700"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
