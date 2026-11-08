import { isRothIraContribution } from "@/lib/pure/contributions/roth-ira";
import { RothRouteSelect } from "@/components/paycheck/roth-route-select";
import type { RothIraRoute } from "@/lib/config/enum-values";
import { Toggle } from "@/components/ui/toggle";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  CONTRIBUTION_METHOD_LABELS,
  EMPLOYER_MATCH_LABELS,
  EMPLOYER_MATCH_VALUE_UNIT,
} from "@/lib/config/display-labels";
import {
  entryMatchFigure,
  matchFigureForForm,
  matchValueToStore,
} from "@/lib/pure/contributions/match-display";
import { FormError } from "@/components/ui/form-error";
import { FormField, FormInput } from "@/components/forms";
import { useDraftCommit } from "@/lib/hooks/use-draft-commit";
import { resolveContribFieldDisplayState } from "@/lib/pure/household/profiles";
import { SlidePanel } from "@/components/ui/slide-panel";
import {
  DeductionForm,
  type DeductionFormValues,
} from "@/components/paycheck/deduction-form";
import { groupSharedMatchAccounts } from "./match-groups";
import type { ActiveFieldsRoot, DeductionRow } from "./profile-types";

/**
 * Same fields as ProfileDetailPanel, rendered as inputs. There is no Save
 * button: each field commits on blur (checkboxes on change, since they have
 * no natural blur moment), sending only that field's patch — the same
 * commit-on-blur model as SavingsAllocationTable. Draft strings exist purely
 * so typing a multi-digit number doesn't fire a mutation per keystroke.
 */
export function ProfileInlineEditor({
  profileId,
  onSaved,
}: {
  profileId: number;
  onSaved: () => void;
}) {
  const { data: profile } = trpc.contributionProfile.getById.useQuery({
    id: profileId,
  });
  const { data: deductionRows } = trpc.settings.deductions.list.useQuery();
  const { drafts, setDraft, clearDraft } = useDraftCommit();
  const utils = trpc.useUtils();
  const [addingDeduction, setAddingDeduction] = useState(false);
  const createDeduction = trpc.settings.deductions.create.useMutation({
    onSuccess: () => {
      utils.settings.invalidate();
      setAddingDeduction(false);
    },
  });
  const updateDeduction = trpc.settings.deductions.update.useMutation({
    onSuccess: () => utils.settings.invalidate(),
  });
  const setAccountActive =
    trpc.settings.contributionAccounts.setActive.useMutation({
      onSuccess: () => {
        utils.settings.contributionAccounts.invalidate();
        utils.contributionProfile.invalidate();
      },
    });
  /** Same generic-field-patch pattern as paycheck/paycheck-content.tsx's onUpdateDeduction
   *  — one call site builds the full record from the current row plus the
   *  one field being changed, instead of each editable cell hand-writing
   *  its own copy of the other four fields. */
  const patchDeductionRecord = (
    d: DeductionRow,
    changes: Partial<
      Pick<DeductionRow, "deductionName" | "isPretax" | "ficaExempt">
    >,
  ) =>
    updateDeduction.mutate({
      id: d.id,
      jobId: d.jobId,
      deductionName: d.deductionName,
      isPretax: d.isPretax,
      ficaExempt: d.ficaExempt,
      ...changes,
    });
  // Over this year's limits on a profile used as a future switch: saved,
  // with the server's warning (switchProfileLimitWarning).
  const [limitWarning, setLimitWarning] = useState<string | null>(null);
  const updateMutation = trpc.contributionProfile.update.useMutation({
    onSuccess: (row) => {
      setLimitWarning(row.limitWarning);
      onSaved();
    },
  });

  // patchAccount/patchDeduction used to read-merge-write the whole
  // contributionActiveFields blob client-side (from a query snapshot that
  // goes stale the instant a prior commit resolves) and PUT it back through
  // `update` — a client-side reimplementation of what
  // setAccountActiveFields/setDeductionActiveFields already do server-side,
  // in one transaction, off the freshest row. Two fields committed in quick
  // succession could silently clobber each other under the old path. These
  // call the server-side patch procedures directly instead.
  const [patchError, setPatchError] = useState<{ message: string } | null>(
    null,
  );
  const setAccountFields =
    trpc.contributionProfile.setAccountActiveFields.useMutation({
      onSuccess: (row) => {
        setPatchError(null);
        setLimitWarning(row.limitWarning);
        onSaved();
      },
      onError: setPatchError,
    });
  const setDeductionFields =
    trpc.contributionProfile.setDeductionActiveFields.useMutation({
      onSuccess: () => {
        setPatchError(null);
        onSaved();
      },
      onError: setPatchError,
    });

  if (!profile) return null;

  const root = (profile.contributionActiveFields ?? {}) as ActiveFieldsRoot; // Stored jsonb, typed by $type only: kept guarded.
  const accountActiveFields = (id: number) =>
    root.contributionAccounts?.[String(id)] ?? {};
  const deductionActiveFields = (id: number) =>
    root.deductions?.[String(id)] ?? {};

  /** Split a {key: value | undefined} changes record into a patch (fields
   *  actually being set) and an unset list (fields being cleared) — the
   *  wire format the server-side patch procedures expect, since a JSON
   *  body can't carry `undefined` as a distinguishable value from "field
   *  omitted". */
  const splitChanges = (changes: Record<string, unknown>) => {
    const fields: Record<string, unknown> = {};
    const unset: string[] = [];
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined) unset.push(key);
      else fields[key] = value;
    }
    return { fields, unset };
  };

  /** Send a patch for one account. `undefined` removes that key. */
  const patchAccount = (
    accountId: number,
    changes: Record<string, unknown>,
  ) => {
    const { fields, unset } = splitChanges(changes);
    setAccountFields.mutate({ profileId, accountId, fields, unset });
  };

  /** Send a patch for one deduction. `undefined` removes that key. */
  const patchDeduction = (
    deductionId: number,
    changes: Record<string, unknown>,
  ) => {
    const { fields, unset } = splitChanges(changes);
    setDeductionFields.mutate({ profileId, deductionId, fields, unset });
  };

  /**
   * Shared blur handler for a numeric field: no-ops when nothing was typed or
   * the typed value matches what's already stored, clears the value when the
   * field was emptied, otherwise sends `toValue(parsed)`.
   */
  const commitNumeric = (
    draftKey: string,
    stored: string,
    apply: (value: unknown) => void,
    toValue: (num: number) => unknown,
  ) => {
    const draft = drafts[draftKey];
    if (draft === undefined) return;
    clearDraft(draftKey);
    const trimmed = draft.trim();
    if (trimmed === stored.trim()) return;
    if (trimmed === "") {
      apply(undefined);
      return;
    }
    const num = parseFloat(trimmed);
    if (isNaN(num)) return;
    apply(toValue(num));
  };

  const commitText = (
    draftKey: string,
    stored: string,
    apply: (value: unknown) => void,
  ) => {
    const draft = drafts[draftKey];
    if (draft === undefined) return;
    clearDraft(draftKey);
    const trimmed = draft.trim();
    if (trimmed === stored.trim()) return;
    apply(trimmed === "" ? undefined : trimmed);
  };

  // Name is renamed from the profile list (click-to-edit on the row) — the
  // one rename gesture shared by every profile manager. This editor pane
  // owns only the fields that have nowhere else to live.
  const commitProfileDescription = () => {
    const draft = drafts["profile:description"];
    if (draft === undefined) return;
    clearDraft("profile:description");
    const trimmed = draft.trim();
    if (trimmed === (profile.description ?? "")) return;
    updateMutation.mutate({ id: profileId, description: trimmed || null });
  };

  return (
    <div>
      <FormError
        error={updateMutation.error ?? patchError}
        prefix="Failed to save profile"
        className="mb-3"
      />
      {limitWarning && (
        <p
          role="status"
          className="mb-3 text-xs text-amber-700 dark:text-amber-400"
        >
          {limitWarning}
        </p>
      )}

      <div className="mb-5 max-w-sm">
        <FormField label="Description">
          <FormInput
            type="text"
            value={drafts["profile:description"] ?? profile.description ?? ""}
            onChange={(e) => setDraft("profile:description", e.target.value)}
            onBlur={commitProfileDescription}
            placeholder="Optional description"
          />
        </FormField>
      </div>

      {profile.accountDetails.length > 0 && (
        <div className="mb-5">
          <h4 className="text-label text-muted mb-2 font-semibold tracking-wide uppercase">
            Contribution Accounts
          </h4>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-strong border-b-2">
                <th
                  className="text-muted w-6 py-2 pl-4 text-left font-medium"
                  title="Enabled in this profile"
                >
                  On
                </th>
                <th className="text-muted px-3 py-2 text-left font-medium">
                  Account
                </th>
                <th className="text-muted w-28 px-3 py-2 text-left font-medium">
                  Method
                </th>
                <th className="text-muted w-24 px-3 py-2 text-right font-medium">
                  Value
                </th>
                <th className="text-muted w-28 px-3 py-2 text-left font-medium">
                  Match Type
                </th>
                <th className="text-muted w-24 px-3 py-2 text-right font-medium">
                  Employer Match
                </th>
                <th className="text-muted w-24 px-3 py-2 text-right font-medium">
                  Match Cap
                </th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const { sharedMatchSource: editSharedMatchSource } =
                  groupSharedMatchAccounts(profile.accountDetails);
                return profile.accountDetails.map((ad, rowIdx) => {
                  const sharedFrom = editSharedMatchSource.get(ad.id);
                  const af = accountActiveFields(ad.id);
                  const storedMethod =
                    af.contributionMethod !== undefined
                      ? String(af.contributionMethod)
                      : "";
                  // The <select> has no blank option: unset shows "% of Salary".
                  const effectiveMethod =
                    drafts[`a${ad.id}:method`] ??
                    (storedMethod || "percent_of_salary");
                  const isPercent = effectiveMethod === "percent_of_salary";
                  // Profile-owned: resolved as applyContribActiveFields does.
                  const storedMatchType =
                    af.employerMatchType !== undefined
                      ? String(af.employerMatchType)
                      : "";
                  const effectiveMatchType =
                    storedMatchType || ad.liveMatchType || "none";
                  const hasMatch = effectiveMatchType !== "none";
                  const isPercentMatch =
                    effectiveMatchType === "percent_of_contribution";
                  const isDisabled = af.isActive === false;
                  const isSaving =
                    setAccountFields.isPending &&
                    setAccountFields.variables.accountId === ad.id;
                  const storedValue =
                    af.contributionValue !== undefined
                      ? String(af.contributionValue)
                      : "";
                  const storedName =
                    af.displayNameCustom !== undefined
                      ? String(af.displayNameCustom)
                      : "";
                  // No resolved value: the live match isn't in effect, so isn't shown.
                  const { hasValue: contribHasValue } =
                    resolveContribFieldDisplayState(af);
                  const ownMatch = entryMatchFigure(effectiveMatchType, af);
                  const storedMatch =
                    ownMatch ??
                    (contribHasValue
                      ? matchFigureForForm(
                          ad.liveMatchType,
                          ad.liveMatchValue,
                          ad.liveMatchRate,
                        )
                      : "");
                  const storedCap =
                    af.employerMaxMatchPct !== undefined
                      ? String(Number(af.employerMaxMatchPct) * 100)
                      : contribHasValue && ad.liveMaxMatchPct != null
                        ? String(Number(ad.liveMaxMatchPct) * 100)
                        : "";
                  return (
                    <tr
                      key={ad.id}
                      aria-busy={isSaving}
                      className={`border-subtle border-b transition-colors hover:bg-blue-50/60 ${
                        rowIdx % 2 === 1
                          ? "bg-surface-sunken/60"
                          : "bg-surface-primary"
                      } ${isDisabled ? "opacity-40" : ""} ${isSaving ? "pointer-events-none opacity-60" : ""}`}
                    >
                      <td className="py-1.5 pl-4 align-top">
                        <input
                          type="checkbox"
                          checked={!isDisabled}
                          disabled={!ad.liveIsActive}
                          onChange={(e) =>
                            patchAccount(ad.id, {
                              isActive: e.target.checked ? undefined : false,
                            })
                          }
                          className="border-strong mt-0.5 rounded disabled:cursor-not-allowed disabled:opacity-40"
                          title={
                            !ad.liveIsActive
                              ? "This account isn't a funding target — this checkbox has no effect until it's restored"
                              : isDisabled
                                ? "Disabled in this profile"
                                : "Enabled in this profile"
                          }
                          aria-label={
                            !ad.liveIsActive
                              ? "This account isn't a funding target — this checkbox has no effect until it's restored"
                              : isDisabled
                                ? "Disabled in this profile"
                                : "Enabled in this profile"
                          }
                        />
                      </td>
                      <td className="text-secondary px-3 py-1.5">
                        <div className={isDisabled ? "line-through" : ""}>
                          {ad.liveAccountName}
                        </div>
                        {!ad.liveIsActive && (
                          <div className="flex items-center gap-1.5">
                            <span
                              className="text-micro font-medium text-amber-500"
                              title="This account isn't a funding target — any value set for it here has no effect."
                            >
                              Not a funding target
                            </span>
                            <button
                              onClick={() =>
                                setAccountActive.mutate({
                                  id: ad.id,
                                  isActive: true,
                                })
                              }
                              disabled={setAccountActive.isPending}
                              className="text-micro text-green-500 hover:text-green-700 disabled:opacity-50"
                            >
                              Restore as funding target
                            </button>
                          </div>
                        )}
                        {!isDisabled && (
                          <input
                            type="text"
                            value={drafts[`a${ad.id}:name`] ?? storedName}
                            onChange={(e) =>
                              setDraft(`a${ad.id}:name`, e.target.value)
                            }
                            onBlur={() =>
                              commitText(
                                `a${ad.id}:name`,
                                storedName,
                                (value) =>
                                  patchAccount(ad.id, {
                                    displayNameCustom: value,
                                  }),
                              )
                            }
                            placeholder="Custom name..."
                            className="text-caption bg-surface-primary text-primary mt-0.5 w-full rounded border px-1.5 py-0.5"
                          />
                        )}
                        {/* This account's election (takesFromBonusCheck) —
                            payroll accounts only; the same switch as Paycheck. */}
                        {!isDisabled && ad.liveIsPayroll && (
                          <div className="mt-1">
                            <Toggle
                              isChecked={af.fromBonus === true}
                              onChange={(v) =>
                                patchAccount(ad.id, {
                                  fromBonus: v || undefined,
                                })
                              }
                              label="Also taken from bonus checks"
                              size="xs"
                            />
                          </div>
                        )}
                        {/* A Roth IRA's route — the same election as
                            Paycheck; absent means direct. */}
                        {!isDisabled && isRothIraContribution(ad) && (
                          <div className="mt-1">
                            <RothRouteSelect
                              value={af.rothRoute as RothIraRoute | undefined}
                              onChange={(v) =>
                                patchAccount(ad.id, {
                                  rothRoute: v === "backdoor" ? v : undefined,
                                })
                              }
                            />
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        <select
                          value={effectiveMethod}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (storedValue.trim() !== "") {
                              // A value already exists — method is already
                              // required-and-present, safe to patch alone.
                              patchAccount(ad.id, { contributionMethod: val });
                            } else {
                              // No value yet — contributionMethod can't be set
                              // alone (required together). Track the pick
                              // locally; the Value field's commit below picks
                              // it up when a real value is finally entered.
                              setDraft(`a${ad.id}:method`, val);
                            }
                          }}
                          className="bg-surface-primary text-primary w-full rounded border px-1.5 py-0.5 text-xs"
                        >
                          {Object.entries(CONTRIBUTION_METHOD_LABELS).map(
                            ([k, label]) => (
                              <option key={k} value={k}>
                                {label}
                              </option>
                            ),
                          )}
                        </select>
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <div className="flex items-center justify-end gap-0.5">
                          <span className="text-caption text-faint w-3 shrink-0 text-right">
                            {isPercent ? "" : "$"}
                          </span>
                          <input
                            type="number"
                            value={drafts[`a${ad.id}:value`] ?? storedValue}
                            onChange={(e) =>
                              setDraft(`a${ad.id}:value`, e.target.value)
                            }
                            onBlur={() =>
                              commitNumeric(
                                `a${ad.id}:value`,
                                storedValue,
                                (value) => {
                                  if (value === undefined) {
                                    // Cleared — both-or-neither, drop the
                                    // method along with the value.
                                    patchAccount(ad.id, {
                                      contributionValue: undefined,
                                      contributionMethod: undefined,
                                    });
                                  } else if (storedValue.trim() === "") {
                                    // First time this account gets a value —
                                    // carry the (possibly just-picked) method
                                    // along with it in the same patch.
                                    patchAccount(ad.id, {
                                      contributionValue: value,
                                      contributionMethod: effectiveMethod,
                                    });
                                    clearDraft(`a${ad.id}:method`);
                                  } else {
                                    patchAccount(ad.id, {
                                      contributionValue: value,
                                    });
                                  }
                                },
                                (num) => String(num),
                              )
                            }
                            placeholder="Not set"
                            className="bg-surface-primary text-primary w-16 rounded border px-1.5 py-0.5 text-right text-xs"
                          />
                          <span className="text-caption text-faint w-3 shrink-0 text-left">
                            {isPercent ? "%" : ""}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-1.5">
                        <select
                          value={effectiveMatchType}
                          onChange={(e) =>
                            patchAccount(ad.id, {
                              employerMatchType: e.target.value,
                            })
                          }
                          className="bg-surface-primary text-primary w-full rounded border px-1.5 py-0.5 text-xs"
                        >
                          {Object.entries(EMPLOYER_MATCH_LABELS).map(
                            ([k, label]) => (
                              <option key={k} value={k}>
                                {label}
                              </option>
                            ),
                          )}
                        </select>
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        {hasMatch ? (
                          <div className="flex items-center justify-end gap-0.5">
                            {EMPLOYER_MATCH_VALUE_UNIT[effectiveMatchType] ===
                              "$" && (
                              <span className="text-caption text-faint w-3 shrink-0 text-right">
                                $
                              </span>
                            )}
                            <input
                              type="number"
                              value={drafts[`a${ad.id}:match`] ?? storedMatch}
                              onChange={(e) =>
                                setDraft(`a${ad.id}:match`, e.target.value)
                              }
                              onBlur={() =>
                                commitNumeric(
                                  `a${ad.id}:match`,
                                  storedMatch,
                                  (value) =>
                                    patchAccount(ad.id, {
                                      employerMatchValue: value,
                                    }),
                                  (num) =>
                                    matchValueToStore(
                                      effectiveMatchType,
                                      String(num),
                                    ),
                                )
                              }
                              title={
                                ownMatch === null && storedMatch !== ""
                                  ? "The account's own match — editing saves a value in this profile only"
                                  : undefined
                              }
                              placeholder="—"
                              className={`bg-surface-primary w-14 rounded border px-1.5 py-0.5 text-right text-xs ${
                                ownMatch === null && storedMatch !== ""
                                  ? "text-faint italic"
                                  : "text-primary"
                              }`}
                            />
                            {EMPLOYER_MATCH_VALUE_UNIT[effectiveMatchType] ===
                              "%" && (
                              <span className="text-caption text-faint">%</span>
                            )}
                          </div>
                        ) : sharedFrom ? (
                          <span
                            className="text-faint italic"
                            title={`Combined with this account's other tax-treatment split — match config is on the ${sharedFrom.accountName} row`}
                          >
                            (combined)
                          </span>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        {hasMatch && isPercentMatch ? (
                          <div className="flex items-center justify-end gap-0.5">
                            <input
                              type="number"
                              value={drafts[`a${ad.id}:cap`] ?? storedCap}
                              onChange={(e) =>
                                setDraft(`a${ad.id}:cap`, e.target.value)
                              }
                              onBlur={() =>
                                commitNumeric(
                                  `a${ad.id}:cap`,
                                  storedCap,
                                  (value) =>
                                    patchAccount(ad.id, {
                                      employerMaxMatchPct: value,
                                    }),
                                  // Display percentage back to decimal (5 → 0.05)
                                  (num) => String(num / 100),
                                )
                              }
                              title={
                                af.employerMaxMatchPct === undefined &&
                                storedCap !== ""
                                  ? "The account's own match — editing saves a value in this profile only"
                                  : undefined
                              }
                              placeholder="—"
                              className={`bg-surface-primary w-14 rounded border px-1.5 py-0.5 text-right text-xs ${
                                af.employerMaxMatchPct === undefined &&
                                storedCap !== ""
                                  ? "text-faint italic"
                                  : "text-primary"
                              }`}
                            />
                            <span className="text-caption text-faint">%</span>
                          </div>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>
                    </tr>
                  );
                });
              })()}
            </tbody>
          </table>
        </div>
      )}

      {/* Deductions — no base value on the row any more (Stage B): each
          deduction is either given an amountPerPeriod by this profile, or
          it has none at all (same "not set" state as an unset contribution
          value, no live fallback). */}
      <div className="mb-5">
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-label text-muted font-semibold tracking-wide uppercase">
            Deductions
          </h4>
          <button
            type="button"
            onClick={() => setAddingDeduction(true)}
            className="text-caption font-medium text-blue-600 hover:text-blue-700"
          >
            + Add Deduction
          </button>
        </div>

        <SlidePanel
          isOpen={addingDeduction}
          onClose={() => setAddingDeduction(false)}
          title="Add Deduction"
        >
          <DeductionForm
            onSave={(data: DeductionFormValues) => createDeduction.mutate(data)}
            onCancel={() => setAddingDeduction(false)}
            isPending={createDeduction.isPending}
          />
        </SlidePanel>

        {deductionRows && deductionRows.length > 0 && (
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-strong border-b-2">
                <th className="text-muted py-2 pr-3 pl-4 text-left font-medium">
                  Deduction
                </th>
                <th className="text-muted w-24 px-3 py-2 text-left font-medium">
                  Pretax
                </th>
                <th className="text-muted w-28 px-3 py-2 text-right font-medium">
                  Amount / Period
                </th>
                <th className="w-16"></th>
              </tr>
            </thead>
            <tbody>
              {deductionRows.map((d: DeductionRow, rowIdx: number) => {
                const df = deductionActiveFields(d.id);
                const storedAmount =
                  df.amountPerPeriod !== undefined
                    ? String(df.amountPerPeriod)
                    : "";
                const personName =
                  profile.deductionDetails.find((dd) => dd.id === d.id)
                    ?.employerName ?? `Job ${d.jobId}`;
                const storedName = d.deductionName;
                const isSaving =
                  setDeductionFields.isPending &&
                  setDeductionFields.variables.deductionId === d.id;
                return (
                  <tr
                    key={d.id}
                    aria-busy={isSaving}
                    className={`border-subtle border-b transition-colors hover:bg-blue-50/60 ${
                      rowIdx % 2 === 1
                        ? "bg-surface-sunken/60"
                        : "bg-surface-primary"
                    } ${isSaving ? "pointer-events-none opacity-60" : ""}`}
                  >
                    <td className="text-secondary py-1.5 pr-3 pl-4">
                      <input
                        type="text"
                        value={drafts[`d${d.id}:name`] ?? storedName}
                        onChange={(e) =>
                          setDraft(`d${d.id}:name`, e.target.value)
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            clearDraft(`d${d.id}:name`);
                            e.currentTarget.blur();
                          } else if (e.key === "Enter") {
                            e.currentTarget.blur();
                          }
                        }}
                        onBlur={() => {
                          const draft = drafts[`d${d.id}:name`];
                          if (draft === undefined) return;
                          clearDraft(`d${d.id}:name`);
                          const trimmed = draft.trim();
                          if (!trimmed || trimmed === storedName) return;
                          patchDeductionRecord(d, { deductionName: trimmed });
                        }}
                        className="bg-surface-primary text-primary w-full rounded border px-1 py-0.5"
                      />
                      <span className="text-faint"> — {personName}</span>
                    </td>
                    <td className="text-muted px-3 py-1.5">
                      <select
                        value={d.isPretax ? "pretax" : "posttax"}
                        onChange={(e) =>
                          patchDeductionRecord(d, {
                            isPretax: e.target.value === "pretax",
                          })
                        }
                        className="bg-surface-primary text-primary rounded border px-1 py-0.5"
                      >
                        <option value="pretax">Pretax</option>
                        <option value="posttax">Post-tax</option>
                      </select>
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <div className="flex items-center justify-end gap-0.5">
                        <span className="text-caption text-faint w-3 shrink-0 text-right">
                          $
                        </span>
                        <input
                          type="number"
                          value={drafts[`d${d.id}:amount`] ?? storedAmount}
                          onChange={(e) =>
                            setDraft(`d${d.id}:amount`, e.target.value)
                          }
                          onBlur={() =>
                            commitNumeric(
                              `d${d.id}:amount`,
                              storedAmount,
                              (value) =>
                                patchDeduction(d.id, {
                                  amountPerPeriod: value,
                                }),
                              (num) => String(num),
                            )
                          }
                          placeholder="Not set"
                          className="bg-surface-primary text-primary w-16 rounded border px-1.5 py-0.5 text-right text-xs"
                        />
                      </div>
                    </td>
                    <td className="py-1.5 pr-4 text-right">
                      {storedAmount !== "" && (
                        <button
                          onClick={() => {
                            clearDraft(`d${d.id}:amount`);
                            patchDeduction(d.id, {
                              amountPerPeriod: undefined,
                            });
                          }}
                          title="Remove this deduction from this profile — its dollar amount is cleared, not just hidden"
                          className="text-caption text-muted hover:text-secondary"
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* The old "Employer & Bonus Handling" jobs active-fields section was
          removed in the Stage B migration — see the matching comment in
          ProfileEditor above. */}
    </div>
  );
}
