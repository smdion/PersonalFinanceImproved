"use client";

import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { FormError } from "@/components/ui/form-error";

// --- Types ---

interface PersonDraft {
  name: string;
  dateOfBirth: string;
  isPrimaryUser: boolean;
}

interface JobDraft {
  personIndex: number;
  employerName: string;
  annualSalary: string;
  payPeriod: "weekly" | "biweekly" | "semimonthly" | "monthly";
}

interface AdminDraft {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
}

interface Props {
  onComplete: () => void;
}

const STEPS = ["Welcome", "Admin", "OIDC", "People", "Income", "Done"] as const;
type Step = (typeof STEPS)[number];

// --- Step components ---

function WelcomeStep({
  onNext,
  onRestore,
}: {
  onNext: () => void;
  onRestore: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-6 py-8">
      <div className="text-4xl font-bold text-primary">Welcome to Ledgr!</div>
      <p className="text-muted max-w-md text-lg">
        Let&apos;s set up your financial dashboard. We&apos;ll walk you through
        a few quick steps to get your household configured.
      </p>
      <button
        onClick={onNext}
        className="px-6 py-3 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors"
      >
        Get Started
      </button>
      <div className="flex items-center gap-3 w-full max-w-xs">
        <div className="flex-1 h-px bg-surface-strong" />
        <span className="text-muted text-sm">or</span>
        <div className="flex-1 h-px bg-surface-strong" />
      </div>
      <button
        onClick={onRestore}
        className="px-6 py-3 rounded-lg border border-default text-muted hover:text-primary hover:bg-surface-elevated transition-colors"
      >
        Restore from Backup
      </button>
    </div>
  );
}

function AdminStep({
  admin,
  setAdmin,
}: {
  admin: AdminDraft;
  setAdmin: (a: AdminDraft) => void;
}) {
  const [errors, setErrors] = useState<Record<string, string | null>>({});

  const validate = (field: string, value: string) => {
    const newErrors = { ...errors };
    if (field === "name" && !value.trim()) {
      newErrors.name = "Name is required";
    } else if (field === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      newErrors.email = "Enter a valid email address";
    } else if (field === "password" && value.length < 12) {
      newErrors.password = "Password must be at least 12 characters";
    } else if (field === "confirmPassword" && value !== admin.password) {
      newErrors.confirmPassword = "Passwords do not match";
    } else {
      newErrors[field] = null;
    }
    setErrors(newErrors);
  };

  const update = (field: keyof AdminDraft, value: string) => {
    setAdmin({ ...admin, [field]: value });
    if (errors[field]) validate(field, value);
  };

  return (
    <div className="flex flex-col gap-6 py-4">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-primary">Create Admin Account</h2>
        <p className="text-muted mt-1">
          Set up a local admin account for logging in. This is your primary
          login and recovery method.
        </p>
      </div>

      <div className="flex flex-col gap-4 max-w-sm mx-auto w-full">
        <div>
          <label className="block text-sm font-medium text-secondary mb-1">
            Display Name
          </label>
          <input
            type="text"
            value={admin.name}
            onChange={(e) => update("name", e.target.value)}
            onBlur={(e) => validate("name", e.target.value)}
            placeholder="Admin"
            className={`w-full px-3 py-2 rounded-lg border bg-surface-primary text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.name ? "border-red-400" : "border-default"}`}
          />
          <FormError message={errors.name ?? null} />
        </div>
        <div>
          <label className="block text-sm font-medium text-secondary mb-1">
            Email
          </label>
          <input
            type="email"
            value={admin.email}
            onChange={(e) => update("email", e.target.value)}
            onBlur={(e) => validate("email", e.target.value)}
            placeholder="admin@example.com"
            className={`w-full px-3 py-2 rounded-lg border bg-surface-primary text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.email ? "border-red-400" : "border-default"}`}
          />
          <FormError message={errors.email ?? null} />
        </div>
        <div>
          <label className="block text-sm font-medium text-secondary mb-1">
            Password
          </label>
          <input
            type="password"
            value={admin.password}
            onChange={(e) => update("password", e.target.value)}
            onBlur={(e) => validate("password", e.target.value)}
            className={`w-full px-3 py-2 rounded-lg border bg-surface-primary text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.password ? "border-red-400" : "border-default"}`}
          />
          <FormError message={errors.password ?? null} />
          <p className="text-xs text-muted mt-1">Minimum 12 characters</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-secondary mb-1">
            Confirm Password
          </label>
          <input
            type="password"
            value={admin.confirmPassword}
            onChange={(e) => update("confirmPassword", e.target.value)}
            onBlur={(e) => validate("confirmPassword", e.target.value)}
            className={`w-full px-3 py-2 rounded-lg border bg-surface-primary text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.confirmPassword ? "border-red-400" : "border-default"}`}
          />
          <FormError message={errors.confirmPassword ?? null} />
        </div>
      </div>
    </div>
  );
}

function OidcStep() {
  const [testResult, setTestResult] = useState<{
    configured: boolean;
    reachable: boolean;
    issuer: string | null;
  } | null>(null);
  const [testing, setTesting] = useState(false);

  const testConnection = trpc.settings.testOidcConnection.useQuery(undefined, {
    enabled: false,
  });

  const handleTest = async () => {
    setTesting(true);
    try {
      const result = await testConnection.refetch();
      setTestResult(result.data ?? null);
    } catch {
      setTestResult({ configured: false, reachable: false, issuer: null });
    }
    setTesting(false);
  };

  const envVars = [
    {
      name: "AUTH_AUTHENTIK_ISSUER",
      description: "Authentik application OAuth2 issuer URL",
      example: "https://auth.example.com/application/o/ledgr",
    },
    {
      name: "AUTH_AUTHENTIK_ID",
      description: "OAuth2 Client ID from the Authentik provider",
      example: "your-client-id",
    },
    {
      name: "AUTH_AUTHENTIK_SECRET",
      description: "OAuth2 Client Secret from the Authentik provider",
      example: "your-client-secret",
    },
  ];

  return (
    <div className="flex flex-col gap-6 py-4">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-primary">Connect to Authentik</h2>
        <p className="text-muted mt-1">
          Enable SSO for your household. You can set this up later in Settings.
        </p>
      </div>

      <div className="bg-surface-secondary rounded-lg p-4 text-sm">
        <p className="text-secondary mb-3">
          Set these environment variables in your Docker Compose or container
          configuration, then restart the container:
        </p>
        <div className="space-y-3">
          {envVars.map((v) => (
            <div key={v.name}>
              <code className="text-blue-600 dark:text-blue-400 font-mono text-xs">
                {v.name}
              </code>
              <p className="text-muted text-xs mt-0.5">{v.description}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Test connection */}
      <div className="flex flex-col items-center gap-3">
        <button
          onClick={handleTest}
          disabled={testing}
          className="px-4 py-2 rounded-lg border border-default text-primary font-medium hover:bg-surface-elevated transition-colors disabled:opacity-50"
        >
          {testing ? "Testing..." : "Test Connection"}
        </button>

        {testResult && (
          <div
            className={`p-3 rounded-lg text-sm w-full text-center ${
              testResult.configured && testResult.reachable
                ? "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400"
                : "bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400"
            }`}
          >
            {testResult.configured && testResult.reachable && (
              <>Authentik is connected ({testResult.issuer})</>
            )}
            {testResult.configured && !testResult.reachable && (
              <>
                Environment variables are set but the issuer is not reachable.
                Check the URL and try again.
              </>
            )}
            {!testResult.configured && (
              <>
                Environment variables are not configured yet. Set them and
                restart the container, then test again.
              </>
            )}
          </div>
        )}
      </div>

      <p className="text-xs text-muted text-center">
        After setting environment variables, restart the container for changes to
        take effect. OIDC can also be configured later from the Settings page.
      </p>
    </div>
  );
}

function PeopleStep({
  people,
  setPeople,
}: {
  people: PersonDraft[];
  setPeople: (p: PersonDraft[]) => void;
}) {
  const [name, setName] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [birthYearError, setBirthYearError] = useState<string | null>(null);

  const addPerson = () => {
    let hasError = false;
    setNameError(null);
    setBirthYearError(null);

    if (!name.trim()) {
      setNameError("Name is required");
      hasError = true;
    }

    if (!birthYear.trim()) {
      setBirthYearError("Birth year is required");
      hasError = true;
    } else {
      const year = parseInt(birthYear, 10);
      if (isNaN(year) || year < 1900 || year > new Date().getFullYear()) {
        setBirthYearError(`Enter a year between 1900 and ${new Date().getFullYear()}`);
        hasError = true;
      }
    }

    if (hasError) return;

    const year = parseInt(birthYear, 10);
    const dateOfBirth = `${year}-01-01`;
    const isPrimary = people.length === 0;
    setPeople([
      ...people,
      { name: name.trim(), dateOfBirth, isPrimaryUser: isPrimary },
    ]);
    setName("");
    setBirthYear("");
    setNameError(null);
    setBirthYearError(null);
  };

  const removePerson = (index: number) => {
    const updated = people.filter((_, i) => i !== index);
    // Ensure first person is still primary
    if (updated.length > 0 && !updated.some((p) => p.isPrimaryUser)) {
      updated[0] = { ...updated[0]!, isPrimaryUser: true };
    }
    setPeople(updated);
  };

  return (
    <div className="flex flex-col gap-6 py-4">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-primary">Household Members</h2>
        <p className="text-muted mt-1">
          Add the people in your household. At least one is required.
        </p>
      </div>

      {/* Existing people list */}
      {people.length > 0 && (
        <div className="space-y-2">
          {people.map((person, i) => (
            <div
              key={i}
              className="flex items-center justify-between bg-surface-primary border border-default rounded-lg px-4 py-3"
            >
              <div>
                <span className="text-primary font-medium">{person.name}</span>
                <span className="text-muted text-sm ml-2">
                  (born {person.dateOfBirth.substring(0, 4)})
                </span>
                {person.isPrimaryUser && (
                  <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                    Primary
                  </span>
                )}
              </div>
              <button
                onClick={() => removePerson(i)}
                className="text-sm text-red-500 hover:text-red-700"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add person form */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <input
            type="text"
            placeholder="Name"
            value={name}
            onChange={(e) => { setName(e.target.value); setNameError(null); }}
            onKeyDown={(e) => e.key === "Enter" && addPerson()}
            className={`w-full px-3 py-2 rounded-lg border bg-surface-primary text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-blue-500 ${nameError ? "border-red-400" : "border-default"}`}
          />
          <FormError message={nameError} />
        </div>
        <div>
          <input
            type="number"
            placeholder="Birth year"
            value={birthYear}
            onChange={(e) => { setBirthYear(e.target.value); setBirthYearError(null); }}
            onKeyDown={(e) => e.key === "Enter" && addPerson()}
            className={`w-32 px-3 py-2 rounded-lg border bg-surface-primary text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-blue-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${birthYearError ? "border-red-400" : "border-default"}`}
          />
          <FormError message={birthYearError} />
        </div>
        <button
          onClick={addPerson}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors self-start"
        >
          Add Person
        </button>
      </div>
    </div>
  );
}

function IncomeStep({
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
        <h2 className="text-2xl font-bold text-primary">Income</h2>
        <p className="text-muted mt-1">
          Add employment information. This step is optional -- you can skip it
          and add jobs later.
        </p>
      </div>

      {/* Existing jobs list */}
      {jobs.length > 0 && (
        <div className="space-y-2">
          {jobs.map((job, i) => (
            <div
              key={i}
              className="flex items-center justify-between bg-surface-primary border border-default rounded-lg px-4 py-3"
            >
              <div>
                <span className="text-primary font-medium">
                  {job.employerName}
                </span>
                <span className="text-muted text-sm ml-2">
                  ({people[job.personIndex]?.name}) -- $
                  {Number(job.annualSalary).toLocaleString()}/{job.payPeriod}
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

      {/* Add job form */}
      <div className="flex flex-col gap-3">
        {people.length > 1 && (
          <select
            value={personIndex}
            onChange={(e) => setPersonIndex(Number(e.target.value))}
            className="px-3 py-2 rounded-lg border border-default bg-surface-primary text-primary focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {people.map((p, i) => (
              <option key={i} value={i}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <input
              type="text"
              placeholder="Employer name"
              value={employerName}
              onChange={(e) => { setEmployerName(e.target.value); setEmployerError(null); }}
              className={`w-full px-3 py-2 rounded-lg border bg-surface-primary text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-blue-500 ${employerError ? "border-red-400" : "border-default"}`}
            />
            <FormError message={employerError} />
          </div>
          <div>
            <input
              type="number"
              placeholder="Annual salary"
              value={annualSalary}
              onChange={(e) => { setAnnualSalary(e.target.value); setSalaryError(null); }}
              className={`w-40 px-3 py-2 rounded-lg border bg-surface-primary text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-blue-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${salaryError ? "border-red-400" : "border-default"}`}
            />
            <FormError message={salaryError} />
          </div>
          <select
            value={payPeriod}
            onChange={(e) =>
              setPayPeriod(e.target.value as JobDraft["payPeriod"])
            }
            className="w-40 px-3 py-2 rounded-lg border border-default bg-surface-primary text-primary focus:outline-none focus:ring-2 focus:ring-blue-500 self-start"
          >
            <option value="weekly">Weekly</option>
            <option value="biweekly">Biweekly</option>
            <option value="semimonthly">Semimonthly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
        <button
          onClick={addJob}
          className="self-start px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors"
        >
          Add Job
        </button>
      </div>
    </div>
  );
}

function DoneStep({ isSaving }: { isSaving: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-6 py-8">
      <div className="text-4xl font-bold text-primary">
        You&apos;re all set!
      </div>
      <p className="text-muted max-w-md text-lg">
        Your dashboard is ready. You can always add more details from the
        Settings page.
      </p>
      {isSaving && <p className="text-muted text-sm">Saving your data...</p>}
    </div>
  );
}

// --- Progress indicator ---

function ProgressBar({
  currentStep,
  steps,
}: {
  currentStep: number;
  steps: readonly string[];
}) {
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {steps.map((label, i) => (
        <div key={label} className="flex items-center gap-2">
          <div className="flex flex-col items-center">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                i < currentStep
                  ? "bg-blue-600 text-white"
                  : i === currentStep
                    ? "bg-blue-600 text-white ring-2 ring-blue-300"
                    : "bg-surface-strong text-muted"
              }`}
            >
              {i < currentStep ? "\u2713" : i + 1}
            </div>
            <span className="text-xs text-muted mt-1 hidden sm:block">
              {label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div
              className={`w-8 sm:w-12 h-0.5 ${
                i < currentStep ? "bg-blue-600" : "bg-surface-strong"
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// --- Main wizard ---

export function OnboardingWizard({ onComplete }: Props) {
  const [step, setStep] = useState(0);
  const [admin, setAdmin] = useState<AdminDraft>({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [adminCreated, setAdminCreated] = useState(false);
  const [people, setPeople] = useState<PersonDraft[]>([]);
  const [jobs, setJobs] = useState<JobDraft[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const createLocalAdmin = trpc.settings.createLocalAdmin.useMutation();
  const createPerson = trpc.settings.people.create.useMutation();
  const createJob = trpc.settings.jobs.create.useMutation();
  const completeOnboarding = trpc.settings.completeOnboarding.useMutation();
  const syncAll = trpc.sync.syncAll.useMutation();

  const handleRestore = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
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
        await syncAll.mutateAsync({ service: "ynab" });
      } catch {
        // No API connection configured or sync failed — not critical
      }

      // Full page reload to pick up all imported data
      window.location.reload();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to restore backup",
      );
      setIsRestoring(false);
    }
  };

  const currentStep: Step = STEPS[step]!;

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
    if (adminCreated) return true;
    setError(null);
    try {
      await createLocalAdmin.mutateAsync({
        name: admin.name.trim(),
        email: admin.email.trim(),
        password: admin.password,
      });
      setAdminCreated(true);
      return true;
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to create admin account.",
      );
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

      // Create all jobs, mapping personIndex to the real person ID
      const today = new Date().toISOString().substring(0, 10);
      for (const job of jobs) {
        const personId = createdPeopleIds[job.personIndex];
        if (personId === undefined) continue;
        await createJob.mutateAsync({
          personId,
          employerName: job.employerName,
          annualSalary: job.annualSalary,
          payPeriod: job.payPeriod,
          payWeek: "na",
          startDate: today,
          w4FilingStatus: "MFJ",
        });
      }

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
    }

    if (step === STEPS.length - 1) {
      // "Done" step -- finish
      handleFinish();
      return;
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const goBack = () => {
    setStepError(null);
    setStep((s) => Math.max(s - 1, 0));
  };

  const skipIncome = () => setStep(STEPS.indexOf("Done"));
  const skipOidc = () => setStep(STEPS.indexOf("People"));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-primary rounded-2xl shadow-2xl border border-default w-full max-w-2xl mx-4 p-6 sm:p-8 max-h-[90vh] overflow-y-auto">
        <ProgressBar currentStep={step} steps={STEPS} />
        <div className="flex items-center justify-center gap-2 mb-4 text-sm text-secondary">
          Step {step + 1} of {STEPS.length}
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
        {currentStep === "Done" && <DoneStep isSaving={isSaving} />}

        {/* Restoring overlay */}
        {isRestoring && (
          <div className="flex flex-col items-center justify-center text-center gap-4 py-8">
            <div className="text-lg font-medium text-primary">
              Restoring backup...
            </div>
            <p className="text-muted text-sm">
              This may take a moment. Please don&apos;t close this page.
            </p>
          </div>
        )}

        {/* Error display */}
        {error && (
          <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
            {error}
          </div>
        )}
        {stepError && (
          <div className="mt-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-sm" role="alert">
            {stepError}
          </div>
        )}

        {/* Navigation buttons (Welcome has its own CTA) */}
        {currentStep !== "Welcome" && (
          <div className="flex items-center justify-between mt-8 pt-4 border-t border-default">
            <button
              onClick={goBack}
              disabled={step === 0 || isSaving}
              className="px-4 py-2 rounded-lg text-muted hover:text-primary hover:bg-surface-elevated disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Back
            </button>
            <div className="flex gap-3">
              {currentStep === "OIDC" && (
                <button
                  onClick={skipOidc}
                  className="px-4 py-2 rounded-lg text-muted hover:text-primary hover:bg-surface-elevated transition-colors"
                >
                  Configure Later
                </button>
              )}
              {currentStep === "Income" && (
                <button
                  onClick={skipIncome}
                  className="px-4 py-2 rounded-lg text-muted hover:text-primary hover:bg-surface-elevated transition-colors"
                >
                  Skip
                </button>
              )}
              <button
                onClick={goNext}
                disabled={isSaving}
                className="px-6 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
      </div>
    </div>
  );
}
