/**
 * Where an edit on the Paycheck page saves — one rule, used for both the
 * write and the label that says so (docs/RULES.md "Profiles and Plans").
 *
 * - Profile fields save to the active profile of their kind: the Salary
 *   Profile for pay, bonus, schedule, W-4, extra-paycheck routing and other
 *   pay; the Contribution Profile for contribution amounts/methods/auto-max
 *   and deduction amounts.
 * - Setup fields (employer, title, deduction name and tax treatment, account
 *   type, linking, adding/removing rows) belong to every profile, so they
 *   save to the household's setup.
 * - Without the permission to edit profiles, profile fields are read-only
 *   and say why — they never fall back to a database write.
 * - While the shared padlock is locked, everything is read-only.
 *
 * Which fields a profile can hold comes from the profile schemas, never a
 * hand-kept list (lib/db/profile-fields.ts).
 */

export type PaycheckFieldKind =
  /** A field of the job's Salary Profile entry. */
  | "salary"
  /** A contribution account's amount/method/auto-max, or a deduction amount. */
  | "contribution"
  /** Shared setup: names, tax treatment, account type, links, add/remove. */
  | "setup";

export type PaycheckEditTarget =
  | { target: "salaryProfile"; label: string }
  | { target: "contributionProfile"; label: string }
  | { target: "setup"; label: string }
  | { target: "readOnly"; label: string };

export type PaycheckEditContext = {
  locked: boolean;
  /** May edit profiles (the `contributionProfile` permission). */
  canEditProfiles: boolean;
  /** May edit the household setup on this page (jobs, deductions, accounts). */
  canEditSetup: boolean;
  salaryProfileName: string | null;
  contributionProfileName: string | null;
};

export function resolvePaycheckEditTarget(
  kind: PaycheckFieldKind,
  ctx: PaycheckEditContext,
): PaycheckEditTarget {
  if (ctx.locked) return { target: "readOnly", label: "View only" };
  if (kind === "setup")
    return ctx.canEditSetup
      ? { target: "setup", label: "Your setup — every profile" }
      : { target: "readOnly", label: "View only" };
  if (!ctx.canEditProfiles)
    return { target: "readOnly", label: "Needs profile edit permission" };
  if (kind === "salary")
    return ctx.salaryProfileName == null
      ? { target: "readOnly", label: "No active Salary Profile" }
      : {
          target: "salaryProfile",
          label: `Saves to Salary Profile “${ctx.salaryProfileName}”`,
        };
  return ctx.contributionProfileName == null
    ? { target: "readOnly", label: "No active Contribution Profile" }
    : {
        target: "contributionProfile",
        label: `Saves to Contribution Profile “${ctx.contributionProfileName}”`,
      };
}
