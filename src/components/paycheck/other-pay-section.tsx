"use client";

/**
 * Other pay & taxable benefits on a job's checks — the lines a stub lists
 * under earnings besides salary: extra pay on every check, or a taxable
 * benefit that's never paid (imputed income, e.g. group life over $50k).
 * The line (name, how it's taxed) is the job's; the amount per check is
 * the Salary Profile's, like salary — saved through onSetAmount.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { HelpTip } from "@/components/ui/help-tip";
import { InlineEdit } from "@/components/ui/inline-edit";
import { formatCurrency } from "@/lib/utils/format";
import {
  EARNING_PRESETS,
  earningPresetFor,
} from "@/lib/config/paycheck-presets";
import { FieldRow } from "@/components/ui/field-row";
import { SectionHeader } from "./section-header";
import { ActionSlot } from "./deduction-row";
import type { EarningRow } from "./types";
import { STATUS_COLORS } from "@/lib/utils/colors";

export function OtherPaySection({
  jobId,
  rows,
  onSetAmount,
  readOnly,
  amountReadOnly,
  lineReadOnly,
  canRemove = true,
  note,
}: {
  /** Where the amounts save. */
  note?: string;
  jobId: number;
  rows: EarningRow[];
  /** Saves a line's per-check amount into the Salary Profile entry. */
  onSetAmount: (earningId: number, amount: number) => void;
  /** Sandbox / scenario preview — nothing editable. */
  readOnly?: boolean;
  /** The salary padlock — amounts live on the same Salary Profile entry. */
  amountReadOnly?: boolean;
  /** Adding a line / changing how it's taxed isn't allowed. */
  lineReadOnly?: boolean;
  /** Removing a line is household setup (admin). */
  canRemove?: boolean;
}) {
  const utils = trpc.useUtils();
  const refresh = () => utils.paycheck.invalidate();
  const create = trpc.settings.earnings.create.useMutation({
    onSuccess: refresh,
  });
  const update = trpc.settings.earnings.update.useMutation({
    onSuccess: refresh,
  });
  const remove = trpc.settings.earnings.delete.useMutation({
    onSuccess: refresh,
  });
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [presetKey, setPresetKey] = useState(EARNING_PRESETS[0]!.key);

  if (rows.length === 0 && (readOnly || lineReadOnly)) return null;

  const setPreset = (row: EarningRow, key: string) => {
    const p = EARNING_PRESETS.find((x) => x.key === key);
    if (!p) return;
    update.mutate({
      id: row.id,
      jobId: row.jobId,
      earningName: row.earningName,
      isCash: p.isCash,
      federalTaxable: p.federalTaxable,
      ficaTaxable: p.ficaTaxable,
    });
  };

  return (
    <div className="space-y-2">
      <SectionHeader note={note}>
        Other pay &amp; taxable benefits
      </SectionHeader>
      <div className="bg-surface-sunken border-subtle space-y-1.5 rounded-lg border p-4 text-sm">
        {rows.length === 0 && (
          <p className="text-caption text-faint">
            None — extra pay on every check, or a taxable benefit you
            aren&apos;t paid (e.g. life insurance over $50k).
          </p>
        )}
        {rows.map((row) => {
          const preset = earningPresetFor(row);
          return (
            <FieldRow
              key={row.id}
              className="group"
              label={
                <span className="text-muted truncate">{row.earningName}</span>
              }
              hint={
                <select
                  aria-label={`How ${row.earningName} is paid and taxed`}
                  value={preset?.key ?? "custom"}
                  onChange={(e) => setPreset(row, e.target.value)}
                  disabled={readOnly || lineReadOnly}
                  title={preset?.label ?? "Custom tax treatment"}
                  className="text-faint -ml-0.5 cursor-pointer appearance-none bg-transparent hover:underline disabled:cursor-default dark:bg-transparent"
                >
                  {EARNING_PRESETS.map((p) => (
                    <option key={p.key} value={p.key} title={p.label}>
                      {p.short}
                    </option>
                  ))}
                  {!preset && <option value="custom">Custom</option>}
                </select>
              }
            >
              <InlineEdit
                value={String(row.amount)}
                onSave={(v) => {
                  const n = Number(v.replace(/[^0-9.]/g, ""));
                  if (Number.isFinite(n) && n >= 0) onSetAmount(row.id, n);
                }}
                formatDisplay={(v) =>
                  `${row.isCash ? "+" : ""}${formatCurrency(Number(v))}`
                }
                parseInput={(v) => v.replace(/[^0-9.]/g, "")}
                type="number"
                isEditable={!readOnly && !amountReadOnly}
                hideEditIcon
              />
              <ActionSlot>
                {!readOnly && canRemove && (
                  <button
                    onClick={() => remove.mutate({ id: row.id })}
                    className="text-faint transition-opacity hover:text-red-500 md:opacity-0 md:group-hover:opacity-100"
                    aria-label={`Remove ${row.earningName}`}
                  >
                    ✕
                  </button>
                )}
              </ActionSlot>
            </FieldRow>
          );
        })}
        {!readOnly &&
          !lineReadOnly &&
          (adding ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const p = EARNING_PRESETS.find((x) => x.key === presetKey)!;
                if (!name.trim()) return;
                create.mutate(
                  {
                    jobId,
                    earningName: name.trim(),
                    isCash: p.isCash,
                    federalTaxable: p.federalTaxable,
                    ficaTaxable: p.ficaTaxable,
                  },
                  {
                    onSuccess: () => {
                      setAdding(false);
                      setName("");
                    },
                  },
                );
              }}
              className="space-y-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs"
            >
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name as on your stub (e.g. Basic Life/AD&D)"
                className="border-strong w-full rounded border px-2 py-1"
                autoFocus
              />
              <select
                aria-label="How your pay stub lists it"
                value={presetKey}
                onChange={(e) => setPresetKey(e.target.value)}
                className="border-strong w-full rounded border px-2 py-1"
              >
                {EARNING_PRESETS.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
              <p className="text-faint">
                Then set its amount per check here (it&apos;s saved with your
                salary in the Salary Profile).
              </p>
              {create.error && (
                <p className={STATUS_COLORS.red.text}>{create.error.message}</p>
              )}
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="rounded bg-blue-600 px-3 py-1 text-white hover:bg-blue-700"
                >
                  Add
                </button>
                <button
                  type="button"
                  onClick={() => setAdding(false)}
                  className="text-muted px-3 py-1"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              onClick={() => setAdding(true)}
              aria-label="Add other pay or a taxable benefit"
              className="text-caption text-blue-600 hover:underline dark:text-blue-400"
            >
              + Add
              <HelpTip text="Lines on your stub's earnings side besides salary. A taxable benefit that isn't paid (e.g. group life insurance over $50k) adds to your taxes but not your take-home." />
            </button>
          ))}
      </div>
    </div>
  );
}
