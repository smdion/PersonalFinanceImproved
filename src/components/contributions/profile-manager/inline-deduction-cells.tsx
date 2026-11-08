import type { DeductionRow } from "./account-row-types";

export function InlineDeductionNameCell({
  drafts,
  d,
  storedName,
  setDraft,
  clearDraft,
  patchDeductionRecord,
  personName,
}: {
  drafts: Record<string, string>;
  d: DeductionRow;
  storedName: string;
  setDraft: (key: string, value: string) => void;
  clearDraft: (key: string) => void;
  patchDeductionRecord: (
    d: DeductionRow,
    changes: Partial<
      Pick<DeductionRow, "deductionName" | "isPretax" | "ficaExempt">
    >,
  ) => void;
  personName: string;
}) {
  return (
    <td className="text-secondary py-1.5 pr-3 pl-4">
      <input
        aria-label={`Deduction, ${personName}`}
        type="text"
        value={drafts[`d${d.id}:name`] ?? storedName}
        onChange={(e) => setDraft(`d${d.id}:name`, e.target.value)}
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
  );
}

export function InlineDeductionPretaxCell({
  d,
  patchDeductionRecord,
}: {
  d: DeductionRow;
  patchDeductionRecord: (
    d: DeductionRow,
    changes: Partial<
      Pick<DeductionRow, "deductionName" | "isPretax" | "ficaExempt">
    >,
  ) => void;
}) {
  return (
    <td className="text-muted px-3 py-1.5">
      <select
        aria-label={`Pretax, ${d.deductionName}`}
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
  );
}

export function InlineDeductionAmountCell({
  drafts,
  d,
  storedAmount,
  setDraft,
  commitNumeric,
  patchDeduction,
}: {
  drafts: Record<string, string>;
  d: DeductionRow;
  storedAmount: string;
  setDraft: (key: string, value: string) => void;
  commitNumeric: (
    draftKey: string,
    stored: string,
    apply: (value: unknown) => void,
    toValue: (num: number) => unknown,
  ) => void;
  patchDeduction: (
    deductionId: number,
    changes: Record<string, unknown>,
  ) => void;
}) {
  return (
    <td className="px-3 py-1.5 text-right">
      <div className="flex items-center justify-end gap-0.5">
        <span className="text-caption text-faint w-3 shrink-0 text-right">
          $
        </span>
        <input
          aria-label={`Amount / Period, ${d.deductionName}`}
          type="number"
          value={drafts[`d${d.id}:amount`] ?? storedAmount}
          onChange={(e) => setDraft(`d${d.id}:amount`, e.target.value)}
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
  );
}

export function InlineDeductionRemoveCell({
  storedAmount,
  clearDraft,
  d,
  patchDeduction,
}: {
  storedAmount: string;
  clearDraft: (key: string) => void;
  d: DeductionRow;
  patchDeduction: (
    deductionId: number,
    changes: Record<string, unknown>,
  ) => void;
}) {
  return (
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
  );
}
