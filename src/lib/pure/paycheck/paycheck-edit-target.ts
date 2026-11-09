/**
 * Where a Paycheck page edit saves, for both the write and its label (docs/DESIGN.md "Profiles
 * and Plans"): profile fields to the active profile of their kind, lines to the job, setup to the
 * household (admin). Read-only without profile-edit permission or while the padlock is locked.
 */

export type PaycheckFieldKind =
  /** A field of the job's Salary Profile entry. */
  | "salary"
  /** A contribution account's amount/method/auto-max/from-bonus, or a deduction amount. */
  | "contribution"
  /** A deduction / other-pay line's name or tax treatment, or adding one. */
  | "line"
  /** Employer, title, contribution accounts, links, removing rows (admin). */
  | "setup";

type PaycheckEditTarget =
  | { target: "salaryProfile"; label: string }
  | { target: "contributionProfile"; label: string }
  | { target: "setup"; label: string }
  | { target: "readOnly"; label: string };

export type PaycheckEditContext = {
  locked: boolean;
  /** May edit profiles (the `contributionProfile` permission). */
  canEditProfiles: boolean;
  /** May edit the household setup (admin): jobs, accounts, removals. */
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
  if (kind === "line")
    return { target: "setup", label: "Your setup — every profile" };
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
