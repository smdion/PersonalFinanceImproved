import { formatCurrency, formatPercent } from "@/lib/utils/format";
import type { Dispatch, SetStateAction } from "react";
import type { ProjectionState } from "./projection-table-types";
import { catDisplayLabel } from "./utils";
import type { OverrideType } from "./override-options";

export function pushAccumOverrideItems(
  state: ProjectionState,
  items: {
    id: string;
    year: number;
    phase: "pre" | "post" | "life";
    type: string;
    summary: string;
    color: string;
    onDelete: () => void;
    onEdit?: () => void;
  }[],
  setSelectedYear: Dispatch<SetStateAction<string>>,
  setSelectedType: Dispatch<SetStateAction<OverrideType | null>>,
  setEditingOverride: Dispatch<
    SetStateAction<{
      phase: "pre" | "post" | "life";
      index: number;
      deleteFirst: () => void;
      initialValue?: string;
    } | null>
  >,
  setWizardStep: Dispatch<SetStateAction<"type" | "year" | "fields">>,
  setShowWizard: Dispatch<SetStateAction<boolean>>,
) {
  for (let i = 0; i < state.accumOverrides.length; i++) {
    const o = state.accumOverrides[i]!;
    const parts: string[] = [];
    if (o.contributionRate != null)
      parts.push(`Rate: ${formatPercent(o.contributionRate, 1)}`);
    if (o.routingMode) parts.push(`Mode: ${o.routingMode}`);
    if (o.lumpSums?.length)
      parts.push(
        o.lumpSums
          .map(
            (ls) =>
              `+${formatCurrency(ls.amount)} ${ls.label ?? ""} → ${ls.targetAccountName ?? catDisplayLabel[ls.targetAccount] ?? ls.targetAccount}`,
          )
          .join(", "),
      );
    if (o.reset) parts.push("Reset to defaults");
    if (o.notes) parts.push(`(${o.notes})`);
    const index = i;
    items.push({
      id: `accum-${o.year}-${i}`,
      year: o.year,
      phase: "pre",
      type: o.reset
        ? "Reset"
        : o.lumpSums?.length
          ? "Lump Sum"
          : o.contributionRate != null
            ? "Contribution"
            : "Change",
      summary: parts.join(" · ") || "Change",
      color: "emerald",
      onDelete: () =>
        state.setAccumOverrides((prev) => prev.filter((_, j) => j !== index)),
      onEdit: () => {
        setSelectedYear(String(o.year));
        setSelectedType(
          o.reset
            ? "reset"
            : o.lumpSums?.length
              ? "lump_sum"
              : o.contributionRate != null
                ? "contribution_rate"
                : o.routingMode
                  ? "routing"
                  : "contribution_rate",
        );
        setEditingOverride({
          phase: "pre",
          index: index,
          deleteFirst: () =>
            state.setAccumOverrides((prev) =>
              prev.filter((_, j) => j !== index),
            ),
          initialValue:
            o.contributionRate != null
              ? String(o.contributionRate * 100)
              : undefined,
        });
        setWizardStep("fields");
        setShowWizard(true);
      },
    });
  }
}

export function pushDecumOverrideItems(
  state: ProjectionState,
  items: {
    id: string;
    year: number;
    phase: "pre" | "post" | "life";
    type: string;
    summary: string;
    color: string;
    onDelete: () => void;
    onEdit?: () => void;
  }[],
  setSelectedYear: Dispatch<SetStateAction<string>>,
  setSelectedType: Dispatch<SetStateAction<OverrideType | null>>,
  setEditingOverride: Dispatch<
    SetStateAction<{
      phase: "pre" | "post" | "life";
      index: number;
      deleteFirst: () => void;
      initialValue?: string;
    } | null>
  >,
  setWizardStep: Dispatch<SetStateAction<"type" | "year" | "fields">>,
  setShowWizard: Dispatch<SetStateAction<boolean>>,
) {
  for (let i = 0; i < state.decumOverrides.length; i++) {
    const o = state.decumOverrides[i]!;
    const parts: string[] = [];
    if (o.rothConversionTarget != null)
      parts.push(
        `Roth Conv: ${o.rothConversionTarget === 0 ? "Off" : formatPercent(o.rothConversionTarget, 0)}`,
      );
    if (o.lumpSums?.length)
      parts.push(
        o.lumpSums
          .map(
            (ls) =>
              `+${formatCurrency(ls.amount)} ${ls.label ?? ""} → ${ls.targetAccountName ?? catDisplayLabel[ls.targetAccount] ?? ls.targetAccount}`,
          )
          .join(", "),
      );
    if (o.reset) parts.push("Reset to defaults");
    if (o.notes) parts.push(`(${o.notes})`);
    const index = i;
    items.push({
      id: `decum-${o.year}-${i}`,
      year: o.year,
      phase: "post",
      type: o.reset ? "Reset" : o.lumpSums?.length ? "Lump Sum" : "Change",
      summary: parts.join(" · ") || "Change",
      color: "amber",
      onDelete: () =>
        state.setDecumOverrides((prev) => prev.filter((_, j) => j !== index)),
      onEdit: () => {
        setSelectedYear(String(o.year));
        setSelectedType(
          o.reset
            ? "reset"
            : o.lumpSums?.length
              ? "lump_sum"
              : o.rothConversionTarget != null
                ? "roth_conversion"
                : "routing",
        );
        setEditingOverride({
          phase: "post",
          index: index,
          deleteFirst: () =>
            state.setDecumOverrides((prev) =>
              prev.filter((_, j) => j !== index),
            ),
          initialValue:
            o.rothConversionTarget != null
              ? String(o.rothConversionTarget * 100)
              : undefined,
        });
        setWizardStep("fields");
        setShowWizard(true);
      },
    });
  }
}
