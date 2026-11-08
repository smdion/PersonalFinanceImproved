/** The first-run wizard's drafts and its step list. */

export interface PersonDraft {
  name: string;
  dateOfBirth: string;
  isPrimaryUser: boolean;
}

export interface JobDraft {
  personIndex: number;
  employerName: string;
  annualSalary: string;
  payPeriod: "weekly" | "biweekly" | "semimonthly" | "monthly";
}

export interface AdminDraft {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
}

export const STEPS = [
  "Welcome",
  "Admin",
  "OIDC",
  "People",
  "Income",
  "Done",
] as const;

export type Step = (typeof STEPS)[number];
