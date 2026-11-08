/** The first-run wizard's Income step. */
import { useState } from "react";
import { FormError } from "@/components/ui/form-error";
import type { PersonDraft, JobDraft } from "./wizard-state";
import { IncomeJobList } from "./income-job-list";

export function IncomeStep({
  people,
  jobs,
  setJobs,
}: {
  people: PersonDraft[];
  jobs: JobDraft[];
  setJobs: (j: JobDraft[]) => void;
}) {
  const [personIndex, setPersonIndex] = useState(0);
  const [employerName, setEmployerName] = useState("");
  const [annualSalary, setAnnualSalary] = useState("");
  const [payPeriod, setPayPeriod] = useState<JobDraft["payPeriod"]>("biweekly");
  const [employerError, setEmployerError] = useState<string | null>(null);
  const [salaryError, setSalaryError] = useState<string | null>(null);

  const addJob = () => {
    let hasError = false;
    setEmployerError(null);
    setSalaryError(null);

    if (!employerName.trim()) {
      setEmployerError("Employer name is required");
      hasError = true;
    }

    if (!annualSalary.trim()) {
      setSalaryError("Annual salary is required");
      hasError = true;
    } else {
      const salary = parseFloat(annualSalary);
      if (isNaN(salary) || salary <= 0) {
        setSalaryError("Enter a valid salary amount");
        hasError = true;
      }
    }

    if (hasError) return;

    const salary = parseFloat(annualSalary);
    setJobs([
      ...jobs,
      {
        personIndex,
        employerName: employerName.trim(),
        annualSalary: salary.toFixed(2),
        payPeriod,
      },
    ]);
    setEmployerName("");
    setAnnualSalary("");
    setEmployerError(null);
    setSalaryError(null);
  };

  const removeJob = (index: number) => {
    setJobs(jobs.filter((_, i) => i !== index));
  };

  return (
    <div className="flex flex-col gap-6 py-4">
      <div className="text-center">
        <h2 className="text-primary text-2xl font-bold">Income</h2>
        <p className="text-muted mt-1">
          Add employment information. This step is optional -- you can skip it
          and add jobs later.
        </p>
      </div>

      {/* Existing jobs list */}
      <IncomeJobList jobs={jobs} people={people} removeJob={removeJob} />

      {/* Add job form */}
      <div className="flex flex-col gap-3">
        {people.length > 1 && (
          <select
            value={personIndex}
            onChange={(e) => setPersonIndex(Number(e.target.value))}
            className="border-default bg-surface-primary text-primary rounded-lg border px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
          >
            {people.map((p, i) => (
              <option key={p.name} value={i}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex-1">
            <input
              type="text"
              placeholder="Employer name"
              value={employerName}
              onChange={(e) => {
                setEmployerName(e.target.value);
                setEmployerError(null);
              }}
              className={`bg-surface-primary text-primary placeholder:text-muted w-full rounded-lg border px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none ${employerError ? "border-red-400" : "border-default"}`}
            />
            <FormError message={employerError} />
          </div>
          <div>
            <input
              type="number"
              placeholder="Annual salary"
              value={annualSalary}
              onChange={(e) => {
                setAnnualSalary(e.target.value);
                setSalaryError(null);
              }}
              className={`bg-surface-primary text-primary placeholder:text-muted w-40 [appearance:textfield] rounded-lg border px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${salaryError ? "border-red-400" : "border-default"}`}
            />
            <FormError message={salaryError} />
          </div>
          <select
            value={payPeriod}
            onChange={(e) =>
              setPayPeriod(e.target.value as JobDraft["payPeriod"])
            }
            className="border-default bg-surface-primary text-primary w-40 self-start rounded-lg border px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
          >
            <option value="weekly">Weekly</option>
            <option value="biweekly">Biweekly</option>
            <option value="semimonthly">Semimonthly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
        <button
          onClick={addJob}
          className="self-start rounded-lg bg-blue-600 px-4 py-2 font-medium text-white transition-colors hover:bg-blue-700"
        >
          Add Job
        </button>
      </div>
    </div>
  );
}
