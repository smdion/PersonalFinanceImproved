import type { ComponentType, Dispatch, SetStateAction } from "react";
import {
  CONTRIBUTION_METHOD_LABELS,
  EMPLOYER_MATCH_LABELS,
  EMPLOYER_MATCH_VALUE_UNIT,
} from "@/lib/config/display-labels";
import type {
  AccountDetail,
  ContribDraft,
  MatchDraft,
} from "./account-row-types";
import type { AccountFieldKey } from "./account-fields";
import { LabelOptions } from "@/components/ui/label-options";

/** One account row's values and setters, as each create-form cell reads them. */
export type NewProfileRowProps = {
  isDisabled: boolean;
  ad: AccountDetail;
  setDisabledAccounts: Dispatch<SetStateAction<Record<string, boolean>>>;
  nameValues: Record<string, string>;
  setNameValues: Dispatch<SetStateAction<Record<string, string>>>;
  effectiveMethod: string;
  setContribValues: Dispatch<SetStateAction<Record<string, ContribDraft>>>;
  isPercent: boolean;
  contribVal: ContribDraft;
  effectiveMatchType: string;
  setMatchValues: Dispatch<SetStateAction<Record<string, MatchDraft>>>;
  hasMatch: boolean;
  mVal: MatchDraft;
  isPercentMatch: boolean;
};

function NewProfileEnabledCell({
  isDisabled,
  ad,
  setDisabledAccounts,
}: NewProfileRowProps) {
  return (
    <td className="py-1.5 align-top">
      <input
        type="checkbox"
        checked={!isDisabled}
        disabled={!ad.liveIsActive}
        onChange={(e) =>
          setDisabledAccounts((prev) => {
            const next = { ...prev };
            if (e.target.checked) delete next[String(ad.id)];
            else next[String(ad.id)] = true;
            return next;
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
  );
}

function NewProfileNameCell({
  isDisabled,
  ad,
  nameValues,
  setNameValues,
}: NewProfileRowProps) {
  return (
    <td className="text-secondary py-1.5">
      <div className={isDisabled ? "line-through" : ""}>
        {ad.liveAccountName}
      </div>
      {!ad.liveIsActive && (
        <div
          className="text-micro font-medium text-amber-500"
          title="This account isn't a funding target — any value set for it here has no effect. Restore it from the profile editor once this profile is created."
        >
          Not a funding target
        </div>
      )}
      {!isDisabled && (
        <input
          aria-label={`Custom name, ${ad.liveAccountName}`}
          type="text"
          value={nameValues[String(ad.id)] ?? ""}
          onChange={(e) =>
            setNameValues((prev) => {
              const next = { ...prev };
              if (e.target.value) next[String(ad.id)] = e.target.value;
              else delete next[String(ad.id)];
              return next;
            })
          }
          placeholder="Custom name..."
          className="text-caption bg-surface-primary text-primary mt-0.5 w-full rounded border px-1.5 py-0.5"
        />
      )}
    </td>
  );
}

function NewProfileMethodCell({
  isDisabled,
  effectiveMethod,
  setContribValues,
  ad,
}: NewProfileRowProps) {
  return (
    <td className="px-1.5 py-1.5">
      {!isDisabled && (
        <select
          aria-label={`Method, ${ad.liveAccountName}`}
          value={effectiveMethod}
          onChange={(e) =>
            setContribValues((prev) => ({
              ...prev,
              [String(ad.id)]: {
                ...prev[String(ad.id)],
                method: e.target.value,
              },
            }))
          }
          className="bg-surface-primary text-primary w-full rounded border px-1.5 py-0.5 text-xs"
        >
          <LabelOptions labels={CONTRIBUTION_METHOD_LABELS} />
        </select>
      )}
    </td>
  );
}

function NewProfileValueCell({
  isDisabled,
  isPercent,
  contribVal,
  setContribValues,
  ad,
}: NewProfileRowProps) {
  return (
    <td className="py-1.5 text-right">
      {!isDisabled && (
        <div className="flex items-center justify-end gap-0.5">
          <span className="text-caption text-faint w-3 shrink-0 text-right">
            {isPercent ? "" : "$"}
          </span>
          <input
            aria-label={`Value, ${ad.liveAccountName}`}
            type="number"
            value={contribVal.value ?? ""}
            onChange={(e) =>
              setContribValues((prev) => ({
                ...prev,
                [String(ad.id)]: {
                  ...prev[String(ad.id)],
                  value: e.target.value,
                },
              }))
            }
            placeholder="Not set"
            className="bg-surface-primary text-primary w-16 rounded border px-1.5 py-0.5 text-right text-xs"
          />
          <span className="text-caption text-faint w-3 shrink-0 text-left">
            {isPercent ? "%" : ""}
          </span>
        </div>
      )}
    </td>
  );
}

function NewProfileMatchTypeCell({
  effectiveMatchType,
  setMatchValues,
  ad,
}: NewProfileRowProps) {
  return (
    <td className="px-1.5 py-1.5">
      <select
        aria-label={`Match Type, ${ad.liveAccountName}`}
        value={effectiveMatchType}
        onChange={(e) =>
          setMatchValues((prev) => ({
            ...prev,
            [String(ad.id)]: {
              ...prev[String(ad.id)],
              matchType: e.target.value,
            },
          }))
        }
        className="bg-surface-primary text-primary w-full rounded border px-1.5 py-0.5 text-xs"
      >
        <LabelOptions labels={EMPLOYER_MATCH_LABELS} />
      </select>
    </td>
  );
}

function NewProfileMatchCell({
  hasMatch,
  effectiveMatchType,
  mVal,
  setMatchValues,
  ad,
}: NewProfileRowProps) {
  return (
    <td className="py-1.5 text-right">
      {hasMatch ? (
        <div className="flex items-center justify-end gap-0.5">
          {EMPLOYER_MATCH_VALUE_UNIT[effectiveMatchType] === "$" && (
            <span className="text-caption text-faint w-3 shrink-0 text-right">
              $
            </span>
          )}
          <input
            aria-label={`Employer Match, ${ad.liveAccountName}`}
            type="number"
            value={mVal.matchValue ?? ""}
            onChange={(e) =>
              setMatchValues((prev) => ({
                ...prev,
                [String(ad.id)]: {
                  ...prev[String(ad.id)],
                  matchValue: e.target.value,
                },
              }))
            }
            placeholder="—"
            className="bg-surface-primary text-primary w-14 rounded border px-1.5 py-0.5 text-right text-xs"
          />
          {EMPLOYER_MATCH_VALUE_UNIT[effectiveMatchType] === "%" && (
            <span className="text-caption text-faint">%</span>
          )}
        </div>
      ) : (
        <span className="text-faint">—</span>
      )}
    </td>
  );
}

function NewProfileCapCell({
  hasMatch,
  isPercentMatch,
  mVal,
  setMatchValues,
  ad,
}: NewProfileRowProps) {
  return (
    <td className="py-1.5 text-right">
      {hasMatch && isPercentMatch ? (
        <div className="flex items-center justify-end gap-0.5">
          <input
            aria-label={`Match Cap, ${ad.liveAccountName}`}
            type="number"
            value={mVal.maxMatchPercent ?? ""}
            onChange={(e) =>
              setMatchValues((prev) => ({
                ...prev,
                [String(ad.id)]: {
                  ...prev[String(ad.id)],
                  maxMatchPercent: e.target.value,
                },
              }))
            }
            placeholder="—"
            className="bg-surface-primary text-primary w-14 rounded border px-1.5 py-0.5 text-right text-xs"
          />
          <span className="text-caption text-faint">%</span>
        </div>
      ) : (
        <span className="text-faint">—</span>
      )}
    </td>
  );
}

/** The create form's cell for each field of ACCOUNT_FIELDS. */
export const NEW_PROFILE_CELLS: Record<
  AccountFieldKey,
  ComponentType<NewProfileRowProps>
> = {
  enabled: NewProfileEnabledCell,
  account: NewProfileNameCell,
  method: NewProfileMethodCell,
  value: NewProfileValueCell,
  matchType: NewProfileMatchTypeCell,
  match: NewProfileMatchCell,
  cap: NewProfileCapCell,
};
