"use client";

/**
 * Shared lump sum form — used by both retirement overrides and brokerage page.
 * Supports injection (positive) and withdrawal (negative) with individual account targeting.
 */
import { useState } from "react";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { goldilocksPlan } from "@/lib/pure/advice/goldilocks";
import type { AccountCategory } from "@/lib/config/account-types";
import type { LumpSumEvent } from "./types";
import {
  choiceKey,
  pickedTarget,
  pickerChoices,
  type PickedAccount,
} from "./lump-sum-target";

type AccountOption = PickedAccount & { category: string };

type LumpSumFormProps = {
  /** Individual accounts available for targeting. */
  accounts: AccountOption[];
  /** Called when user submits a new lump sum. */
  onAdd: (ls: LumpSumEvent) => void;
  /** Allow negative amounts (withdrawals). Default false. */
  allowWithdrawals?: boolean;
  /** Default year for the form. */
  defaultYear?: string;
  /** What the projection has invested at the start of a year — sizes Money
   *  Guy's Goldilocks tip for money coming in. Omitted = no tip. */
  investedAtStartOf?: (year: number) => number | undefined;
};

export function LumpSumForm({
  accounts,
  onAdd,
  allowWithdrawals = false,
  defaultYear,
  investedAtStartOf,
}: LumpSumFormProps) {
  const choices = pickerChoices(accounts);
  const [form, setForm] = useState({
    year: defaultYear ?? String(new Date().getFullYear() + 1),
    direction: "in" as "in" | "out",
    amount: "",
    targetAccountName: choices[0]?.picked.targetAccountName ?? "",
    targetOwnerName: choices[0]?.picked.targetOwnerName ?? "",
    targetSide: choices[0]?.picked.targetSide,
    targetAccount: (accounts[0]?.category ?? "brokerage") as AccountCategory,
    label: "",
  });

  const handleSubmit = () => {
    const amount = parseFloat(form.amount);
    if (isNaN(amount) || amount <= 0) return;

    const finalAmount =
      form.direction === "out" ? String(-amount) : String(amount);

    onAdd({
      id: crypto.randomUUID(),
      year: form.year,
      amount: finalAmount,
      targetAccount: form.targetAccount,
      ...pickedTarget(accounts, form),
      label: form.label,
    });

    setForm((f) => ({ ...f, amount: "", label: "" }));
  };

  const goldilocks =
    form.direction === "in" && investedAtStartOf
      ? goldilocksPlan(
          parseFloat(form.amount),
          investedAtStartOf(Number(form.year)) ?? 0,
        )
      : null;

  return (
    <div className="space-y-1">
      <div
        className={`grid items-end gap-2 text-sm ${
          allowWithdrawals
            ? "grid-cols-[80px_80px_1fr_1fr_1fr_auto]"
            : "grid-cols-[80px_1fr_1fr_1fr_auto]"
        }`}
      >
        <label className="block">
          <span className="text-caption text-muted">Year</span>
          <input
            type="number"
            value={form.year}
            onChange={(e) => setForm((f) => ({ ...f, year: e.target.value }))}
            className="border-strong mt-0.5 block w-full rounded border px-2 py-1 text-sm"
          />
        </label>
        {allowWithdrawals && (
          <label className="block">
            <span className="text-caption text-muted">Type</span>
            <select
              value={form.direction}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  direction: e.target.value as "in" | "out",
                }))
              }
              className="border-strong mt-0.5 block w-full rounded border px-2 py-1 text-sm"
            >
              <option value="in">Inject</option>
              <option value="out">Withdraw</option>
            </select>
          </label>
        )}
        <label className="block">
          <span className="text-caption text-muted">Amount</span>
          <input
            type="number"
            min={0}
            placeholder="$50,000"
            value={form.amount}
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            className="border-strong mt-0.5 block w-full rounded border px-2 py-1 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-caption text-muted">Account</span>
          <select
            value={
              choices.some((c) => c.key === choiceKey(form))
                ? choiceKey(form)
                : form.targetAccount
            }
            onChange={(e) => {
              const val = e.target.value;
              const choice = choices.find((c) => c.key === val);
              setForm((f) => ({
                ...f,
                targetAccountName: choice?.picked.targetAccountName ?? "",
                targetOwnerName: choice?.picked.targetOwnerName ?? "",
                targetSide: choice?.picked.targetSide,
                targetAccount: choice
                  ? (choice.account.category as AccountCategory)
                  : (val as AccountCategory),
              }));
            }}
            className="border-strong mt-0.5 block w-full rounded border px-2 py-1 text-sm"
          >
            {choices.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-caption text-muted">Label</span>
          <input
            type="text"
            placeholder={
              allowWithdrawals ? "Bonus / Down payment" : "Inheritance"
            }
            value={form.label}
            onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
            className="border-strong mt-0.5 block w-full rounded border px-2 py-1 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={handleSubmit}
          className="rounded bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-700"
        >
          Add
        </button>
      </div>
      {goldilocks && (
        <p className="text-caption text-muted">
          About {formatPercent(goldilocks.share, 0)} of what you&apos;ll have
          invested then.{" "}
          {goldilocks.months === 0
            ? "Money Guy's Goldilocks rule: under 10%, invest it at once."
            : `Money Guy's Goldilocks rule: spread it over ${goldilocks.months} months.`}
        </p>
      )}
    </div>
  );
}

/** Renders a saved lump sum as a badge with edit and delete buttons. */
export function LumpSumBadge({
  event,
  onEdit,
  onDelete,
  color = "emerald",
}: {
  event: LumpSumEvent;
  onEdit?: () => void;
  onDelete?: () => void;
  color?: "emerald" | "amber";
}) {
  const amount = parseFloat(event.amount);
  const isWithdrawal = amount < 0;
  const bgClass = color === "amber" ? "bg-amber-50" : "bg-emerald-50";
  const textClass = color === "amber" ? "text-amber-700" : "text-emerald-700";
  const mutedClass = color === "amber" ? "text-amber-400" : "text-emerald-400";

  return (
    <div
      className={`flex items-center justify-between ${bgClass} rounded px-3 py-1.5 text-xs`}
    >
      <div className={textClass}>
        <span className="font-semibold">{event.year}+</span>{" "}
        {event.targetAccountName && (
          <span className={mutedClass}>
            {event.targetAccountName.split(" (")[0]}{" "}
          </span>
        )}
        <span>
          {isWithdrawal ? "" : "+"}
          {formatCurrency(amount)}
        </span>
        {" → "}
        {event.targetAccountName || event.targetAccount}
        {event.label && <span className={mutedClass}> {event.label}</span>}
      </div>
      <span className="ml-2 flex items-center gap-1">
        {onEdit && (
          <button
            type="button"
            className={`${mutedClass} hover:text-primary`}
            onClick={onEdit}
            aria-label="Edit lump sum"
          >
            &#9998;
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            className={`${mutedClass} hover:text-red-500`}
            onClick={onDelete}
            aria-label="Remove lump sum"
          >
            ×
          </button>
        )}
      </span>
    </div>
  );
}
