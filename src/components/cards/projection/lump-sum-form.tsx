"use client";

/**
 * Shared lump sum form — used by both retirement overrides and brokerage page.
 * Supports injection (positive) and withdrawal (negative) with individual account targeting.
 */
import { useState } from "react";
import { formatCurrency } from "@/lib/utils/format";
import type { AccountCategory } from "@/lib/calculators/types";
import type { LumpSumEvent } from "./types";

type AccountOption = {
  name: string;
  category: string;
  taxType?: string;
};

type LumpSumFormProps = {
  /** Individual accounts available for targeting. */
  accounts: AccountOption[];
  /** Called when user submits a new lump sum. */
  onAdd: (ls: LumpSumEvent) => void;
  /** Allow negative amounts (withdrawals). Default false. */
  allowWithdrawals?: boolean;
  /** Default year for the form. */
  defaultYear?: string;
};

export function LumpSumForm({
  accounts,
  onAdd,
  allowWithdrawals = false,
  defaultYear,
}: LumpSumFormProps) {
  const [form, setForm] = useState({
    year: defaultYear ?? String(new Date().getFullYear() + 1),
    direction: "in" as "in" | "out",
    amount: "",
    targetAccountName: accounts[0]?.name ?? "",
    targetAccount: (accounts[0]?.category ?? "brokerage") as AccountCategory,
    taxType: "" as "traditional" | "roth" | "",
    label: "",
  });

  const handleSubmit = () => {
    const amt = parseFloat(form.amount);
    if (isNaN(amt) || amt <= 0) return;

    const finalAmount = form.direction === "out" ? String(-amt) : String(amt);

    onAdd({
      id: crypto.randomUUID(),
      year: form.year,
      amount: finalAmount,
      targetAccount: form.targetAccount,
      targetAccountName: form.targetAccountName,
      taxType: form.taxType,
      label: form.label,
    });

    setForm((f) => ({ ...f, amount: "", label: "" }));
  };

  return (
    <div
      className={`grid gap-2 items-end text-sm ${
        allowWithdrawals
          ? "grid-cols-[80px_80px_1fr_1fr_1fr_auto]"
          : "grid-cols-[80px_1fr_1fr_1fr_auto]"
      }`}
    >
      <label className="block">
        <span className="text-[10px] text-muted">Year</span>
        <input
          type="number"
          value={form.year}
          onChange={(e) => setForm((f) => ({ ...f, year: e.target.value }))}
          className="mt-0.5 block w-full rounded border border-strong px-2 py-1 text-sm"
        />
      </label>
      {allowWithdrawals && (
        <label className="block">
          <span className="text-[10px] text-muted">Type</span>
          <select
            value={form.direction}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                direction: e.target.value as "in" | "out",
              }))
            }
            className="mt-0.5 block w-full rounded border border-strong px-2 py-1 text-sm"
          >
            <option value="in">Inject</option>
            <option value="out">Withdraw</option>
          </select>
        </label>
      )}
      <label className="block">
        <span className="text-[10px] text-muted">Amount</span>
        <input
          type="number"
          min={0}
          placeholder="$50,000"
          value={form.amount}
          onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
          className="mt-0.5 block w-full rounded border border-strong px-2 py-1 text-sm"
        />
      </label>
      <label className="block">
        <span className="text-[10px] text-muted">Account</span>
        <select
          value={form.targetAccountName || form.targetAccount}
          onChange={(e) => {
            const val = e.target.value;
            const acct = accounts.find((a) => a.name === val);
            setForm((f) => ({
              ...f,
              targetAccountName: acct ? val : "",
              targetAccount: acct
                ? (acct.category as AccountCategory)
                : (val as AccountCategory),
            }));
          }}
          className="mt-0.5 block w-full rounded border border-strong px-2 py-1 text-sm"
        >
          {accounts.map((a) => (
            <option key={a.name} value={a.name}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-[10px] text-muted">Label</span>
        <input
          type="text"
          placeholder={
            allowWithdrawals ? "Bonus / Down payment" : "Inheritance"
          }
          value={form.label}
          onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
          className="mt-0.5 block w-full rounded border border-strong px-2 py-1 text-sm"
        />
      </label>
      <button
        type="button"
        onClick={handleSubmit}
        className="bg-emerald-600 text-white text-xs rounded px-3 py-1.5 hover:bg-emerald-700"
      >
        Add
      </button>
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
  const amt = parseFloat(event.amount);
  const isWithdrawal = amt < 0;
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
          {formatCurrency(amt)}
        </span>
        {" → "}
        {event.targetAccountName || event.targetAccount}
        {event.label && <span className={mutedClass}> {event.label}</span>}
      </div>
      <span className="flex items-center gap-1 ml-2">
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
