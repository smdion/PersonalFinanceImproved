"use client";

/** Settings tab for managing Medicare IRMAA surcharge brackets by tax year and filing status, with inline threshold/surcharge editing and year duplication. */
import { trpc } from "@/lib/trpc";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { formatCurrency } from "@/lib/utils/format";
import {
  BracketTableEditor,
  numericCell,
  type BracketFilingStatus,
  type BracketRow,
} from "./bracket-table-editor";

type IrmaaEntry = { magiThreshold: number; annualSurcharge: number };

export function IrmaaBracketsSettings({ year }: { year: number }) {
  const admin = isAdmin(useUser());
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.settings.irmaaBrackets.list.useQuery();
  const invalidate = () => utils.settings.irmaaBrackets.invalidate();
  const updateMutation = trpc.settings.irmaaBrackets.update.useMutation({
    onSuccess: invalidate,
  });
  const createMutation = trpc.settings.irmaaBrackets.create.useMutation({
    onSuccess: invalidate,
  });
  const deleteMutation = trpc.settings.irmaaBrackets.delete.useMutation({
    onSuccess: invalidate,
  });

  const rows = (data ?? []) as BracketRow<IrmaaEntry>[];

  return (
    <BracketTableEditor<IrmaaEntry>
      title="IRMAA Tables"
      noun="IRMAA"
      year={year}
      admin={admin}
      isLoading={isLoading}
      rows={rows}
      defaultBrackets={[{ magiThreshold: 0, annualSurcharge: 0 }]}
      entryKey={(e) => e.magiThreshold}
      intro={
        <>
          IRMAA uses a 2-year MAGI lookback — {year} premiums are based on{" "}
          {year - 2} MAGI. Surcharges are per-person (Part B + Part D combined,
          above the standard premium). Brackets are cliff-based — going $1 over
          triggers the full surcharge.
        </>
      }
      sourceNote="Source: CMS Medicare Part B/D premium adjustments. Surcharges are per person per year."
      columns={[
        {
          header: "MAGI Over",
          cell: numericCell<IrmaaEntry>({
            value: (e) => e.magiThreshold,
            display: (e) => formatCurrency(e.magiThreshold),
            field: "magiThreshold",
          }),
        },
        {
          header: "Annual",
          align: "right",
          cell: numericCell<IrmaaEntry>({
            value: (e) => e.annualSurcharge,
            display: (e) => formatCurrency(e.annualSurcharge),
            field: "annualSurcharge",
          }),
        },
        {
          header: "Monthly",
          align: "right",
          cell: (e) => (
            <span className="text-muted text-xs">
              {formatCurrency(e.annualSurcharge / 12)}/mo
            </span>
          ),
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
