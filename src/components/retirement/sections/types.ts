/**
 * Prop types for the retirement-content section components, read from the
 * routers' own types. The parent renders sections only once
 * getProjectionMetadata's `settings` is loaded, so they never see it missing.
 */
import type { RouterInputs, RouterOutputs } from "@/lib/trpc";

type ProjectionData = Extract<
  RouterOutputs["projection"]["getProjectionMetadata"],
  { settings: unknown }
>;
type ProfilePeople = RouterInputs["retirement"]["retirementProfilePeople"];

/** The retirement settings getProjectionMetadata returns. */
export type Settings = ProjectionData["settings"];
/** Per-person retirement settings; sections also take null (none loaded). */
export type PerPersonSettings = ProjectionData["perPersonSettings"] | null;
/** The active scenario's distribution tax rates, or null. */
export type SelectedScenario = ProjectionData["selectedScenario"];
/** Return-rate summary for the Glide Path section. */
export type ReturnRateSummary = ProjectionData["returnRateSummary"];
/** Budget profile summaries for the Per-Phase Budget section. */
export type BudgetProfileSummaries = ProjectionData["budgetProfileSummaries"];
/** A contribution profile as the Income section lists it. */
export type ContributionProfileListEntry = Pick<
  RouterOutputs["contributionProfile"]["list"][number],
  "id" | "name"
>;

type UpsertInput = RouterInputs["retirement"]["retirementSettings"]["upsert"];

/** A settings edit: any Settings field, with `filingStatus` as stored (null
 *  clears it back to the resolved status). */
export type SettingsPatch = Partial<Omit<Settings, "filingStatus">> &
  Pick<UpsertInput, "filingStatus">;

/** Payload for `retirementSettings.upsert`: its six required anchor fields,
 *  and the edit. */
export type UpsertSettingsInput = Pick<
  UpsertInput,
  | "personId"
  | "retirementAge"
  | "endAge"
  | "returnAfterRetirement"
  | "annualInflation"
  | "salaryAnnualIncrease"
> &
  SettingsPatch;

/** The upsert mutation pass-through. Sections only need `.mutate(...)` —
 *  the parent owns the optimistic update pipeline. */
export type UpsertSettingsMutation = {
  mutate: (input: UpsertSettingsInput) => void;
};

/** `retirementProfilePeople.upsertPerson` pass-through — per-person fields
 *  that live on `retirement_profile_people`, not `retirement_settings`. */
export type UpsertProfilePersonMutation = {
  mutate: (input: ProfilePeople["upsertPerson"]) => void;
};

/** `retirementProfilePeople.upsertHouseholdFields` pass-through — one
 *  household-wide control stored per person, fanned out server-side. */
export type UpsertProfileHouseholdFieldsMutation = {
  mutate: (input: ProfilePeople["upsertHouseholdFields"]) => void;
};

/** Whether the current user may edit `retirement_settings` via
 *  `retirementSettings.upsert` (adminProcedure server-side). Sections use
 *  this to render read-only instead of hiding controls entirely — a
 *  non-admin can still see the values, just not change them. */
export type IsEditable = boolean;
