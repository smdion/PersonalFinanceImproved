import { isRothIraContribution } from "@/lib/pure/contributions/roth-ira";
import { RothRouteSelect } from "@/components/paycheck/roth-route-select";
import type { RothIraRoute } from "@/lib/config/enum-values";
import { Toggle } from "@/components/ui/toggle";
import { CONTRIBUTION_METHOD_LABELS } from "@/lib/config/display-labels";
import type { InlineRowProps } from "./account-row-types";

export function InlineEnabledCell({
  isDisabled,
  ad,
  patchAccount,
}: InlineRowProps) {
  return (
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
  );
}

export function InlineNameCell({
  isDisabled,
  ad,
  setAccountActive,
  drafts,
  storedName,
  setDraft,
  commitText,
  patchAccount,
  af,
}: InlineRowProps) {
  return (
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
          onChange={(e) => setDraft(`a${ad.id}:name`, e.target.value)}
          onBlur={() =>
            commitText(`a${ad.id}:name`, storedName, (value) =>
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
  );
}

export function InlineMethodCell({
  effectiveMethod,
  storedValue,
  patchAccount,
  ad,
  setDraft,
}: InlineRowProps) {
  return (
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
        {Object.entries(CONTRIBUTION_METHOD_LABELS).map(([k, label]) => (
          <option key={k} value={k}>
            {label}
          </option>
        ))}
      </select>
    </td>
  );
}

export function InlineValueCell({
  isPercent,
  drafts,
  ad,
  storedValue,
  setDraft,
  commitNumeric,
  patchAccount,
  effectiveMethod,
  clearDraft,
}: InlineRowProps) {
  return (
    <td className="px-3 py-1.5 text-right">
      <div className="flex items-center justify-end gap-0.5">
        <span className="text-caption text-faint w-3 shrink-0 text-right">
          {isPercent ? "" : "$"}
        </span>
        <input
          type="number"
          value={drafts[`a${ad.id}:value`] ?? storedValue}
          onChange={(e) => setDraft(`a${ad.id}:value`, e.target.value)}
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
  );
}
