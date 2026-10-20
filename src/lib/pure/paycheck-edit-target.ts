/**
 * Where an edit on the Paycheck page saves — one rule, used for both the
 * write and the label that says so (docs/RULES.md "Profiles and Plans").
 *
 * - Profile fields save to the active profile of their kind: the Salary
 *   Profile for pay, bonus, schedule, W-4, extra-paycheck routing and other
 *   pay; the Contribution Profile for contribution amounts/methods/auto-max,
 *   whether each is also taken from bonus checks, and deduction amounts.
 * - Lines — a deduction's or other-pay line's name and tax treatment, and
 *   adding one — belong to the job (every profile), and need the same
 *   permission as editing profiles (the server's deductions / earnings
 *   create+update).
 * - Setup — employer, title, contribution accounts and their links, and
 *   removing any row — belongs to the household and is admin-only, as the
 *   server enforces.
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
  /** A contribution account's amount/method/auto-max/from-bonus, or a deduction amount. */
  | "contribution"
  /** A deduction / other-pay line's name or tax treatment, or adding one. */
  | "line"
  /** Employer, title, contribution accounts, links, removing rows (admin). */
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
