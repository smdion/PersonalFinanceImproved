import {
  EMPLOYER_MATCH_LABELS,
  EMPLOYER_MATCH_VALUE_UNIT,
} from "@/lib/config/display-labels";
import { matchValueToStore } from "@/lib/pure/contributions/match-display";
import type { InlineRowProps } from "./account-row-types";
import { LabelOptions } from "@/components/ui/label-options";

export function InlineMatchTypeCell({
  effectiveMatchType,
  patchAccount,
  ad,
}: InlineRowProps) {
  return (
    <td className="px-3 py-1.5">
      <select
        aria-label={`Match Type, ${ad.liveAccountName}`}
        value={effectiveMatchType}
        onChange={(e) =>
          patchAccount(ad.id, {
            employerMatchType: e.target.value,
          })
        }
        className="bg-surface-primary text-primary w-full rounded border px-1.5 py-0.5 text-xs"
      >
        <LabelOptions labels={EMPLOYER_MATCH_LABELS} />
      </select>
    </td>
  );
}

export function InlineMatchCell({
  hasMatch,
  effectiveMatchType,
  drafts,
  ad,
  storedMatch,
  setDraft,
  commitNumeric,
  patchAccount,
  ownMatch,
  sharedFrom,
}: InlineRowProps) {
  return (
    <td className="px-3 py-1.5 text-right">
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
            value={drafts[`a${ad.id}:match`] ?? storedMatch}
            onChange={(e) => setDraft(`a${ad.id}:match`, e.target.value)}
            onBlur={() =>
              commitNumeric(
                `a${ad.id}:match`,
                storedMatch,
                (value) =>
                  patchAccount(ad.id, {
                    employerMatchValue: value,
                  }),
                (num) => matchValueToStore(effectiveMatchType, String(num)),
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
          {EMPLOYER_MATCH_VALUE_UNIT[effectiveMatchType] === "%" && (
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
  );
}

export function InlineCapCell({
  hasMatch,
  isPercentMatch,
  drafts,
  ad,
  storedCap,
  setDraft,
  commitNumeric,
  patchAccount,
  af,
}: InlineRowProps) {
  return (
    <td className="px-3 py-1.5 text-right">
      {hasMatch && isPercentMatch ? (
        <div className="flex items-center justify-end gap-0.5">
          <input
            aria-label={`Match Cap, ${ad.liveAccountName}`}
            type="number"
            value={drafts[`a${ad.id}:cap`] ?? storedCap}
            onChange={(e) => setDraft(`a${ad.id}:cap`, e.target.value)}
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
              af.employerMaxMatchPct === undefined && storedCap !== ""
                ? "The account's own match — editing saves a value in this profile only"
                : undefined
            }
            placeholder="—"
            className={`bg-surface-primary w-14 rounded border px-1.5 py-0.5 text-right text-xs ${
              af.employerMaxMatchPct === undefined && storedCap !== ""
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
  );
}
