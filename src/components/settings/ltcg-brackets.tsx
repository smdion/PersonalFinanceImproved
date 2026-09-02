"use client";

/** Settings tab for managing long-term capital gains tax brackets by tax year and filing status, with inline threshold/rate editing and year duplication. */
import { trpc } from "@/lib/trpc";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { InlineEdit } from "@/components/ui/inline-edit";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import {
  BracketTableEditor,
  numericCell,
  type BracketFilingStatus,
  type BracketRow,
} from "./bracket-table-editor";

type LtcgEntry = { threshold: number | null; rate: number };

export function LtcgBracketsSettings({ year }: { year: number }) {
  const admin = isAdmin(useUser());
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.settings.ltcgBrackets.list.useQuery();
  const invalidate = () => utils.settings.ltcgBrackets.invalidate();
  const updateMutation = trpc.settings.ltcgBrackets.update.useMutation({
    onSuccess: invalidate,
  });
  const createMutation = trpc.settings.ltcgBrackets.create.useMutation({
    onSuccess: invalidate,
  });
  const deleteMutation = trpc.settings.ltcgBrackets.delete.useMutation({
    onSuccess: invalidate,
  });

  const rows = (data ?? []) as BracketRow<LtcgEntry>[];

  return (
    <BracketTableEditor<LtcgEntry>
      title="Long-Term Capital Gains Brackets"
      noun="LTCG"
      year={year}
      admin={admin}
      isLoading={isLoading}
      rows={rows}
      defaultBrackets={[
        { threshold: 0, rate: 0 },
        { threshold: 0, rate: 0.15 },
        { threshold: null, rate: 0.2 },
      ]}
      entryKey={(e) => String(e.threshold)}
      sourceNote="Source: IRS Revenue Procedure (adjusted annually for inflation). Rates apply to long-term gains based on total taxable income. Edit rates as percentages (e.g., enter 15 for 15%)."
      columns={[
        {
          header: "Up To",
          cell: (entry, { onSave, isEditable }) =>
            entry.threshold === null ? (
              <span className="text-sm text-muted">Above</span>
            ) : (
              <InlineEdit
                value={entry.threshold.toString()}
                formatDisplay={() => formatCurrency(entry.threshold as number)}
                parseInput={(raw) => raw.replace(/[$,\s]/g, "")}
                onSave={(v) => {
                  const n = parseFloat(v);
                  if (!isNaN(n)) onSave({ threshold: n });
                }}
                type="number"
                className="text-sm"
                isEditable={isEditable}
              />
            ),
        },
        {
          header: "Rate",
          align: "right",
          cell: numericCell<LtcgEntry>({
            value: (e) => e.rate * 100,
            display: (e) => formatPercent(e.rate, 1),
            field: "rate",
            strip: (raw) => raw.replace(/%/g, "").trim(),
            transform: (n) => n / 100,
          }),
        },
      ]}
      onUpdateRow={(rowId, brackets) => {
        const row = rows.find((r) => r.id === rowId);
        if (!row) return;
        updateMutation.mutate({
          id: rowId,
          taxYear: row.taxYear,
          filingStatus: row.filingStatus as BracketFilingStatus,
          brackets,
        });
      }}
      onCreateRow={(taxYear, filingStatus, brackets) =>
        createMutation.mutateAsync({ taxYear, filingStatus, brackets })
      }
      onDeleteRow={(id) => deleteMutation.mutateAsync({ id })}
    />
  );
}
