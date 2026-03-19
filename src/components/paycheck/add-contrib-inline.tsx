"use client";

import { useState } from "react";
import type { CreateContribData } from "./types";
import type { AccountCategory } from "./types";
import {
  getAllCategories,
  getAccountTypeConfig,
} from "@/lib/config/account-types";

export function AddContribInline({
  personId,
  jobId,
  onCreateContrib,
}: {
  personId: number;
  jobId: number | null;
  onCreateContrib: (data: CreateContribData) => void;
}) {
  const [open, setOpen] = useState(false);
  const [accountType, setAccountType] = useState<AccountCategory>("401k");
  const [taxTreatment, setTaxTreatment] = useState<
    "pre_tax" | "tax_free" | "after_tax" | "hsa"
  >("pre_tax");
  const [method, setMethod] = useState<
    "percent_of_salary" | "fixed_per_period" | "fixed_monthly" | "fixed_annual"
  >("percent_of_salary");
  const [value, setValue] = useState("");

  const reset = () => {
    setAccountType("401k");
    setTaxTreatment("pre_tax");
    setMethod("percent_of_salary");
    setValue("");
    setOpen(false);
  };

  if (!open) {
    return (
      <div className="flex justify-center pt-1">
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 transition-colors"
        >
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 4v16m8-8H4"
            />
          </svg>
          Add contribution account
        </button>
      </div>
    );
  }

  return (
    <div className="border border-blue-200 bg-blue-50/30 rounded-lg p-3 space-y-2">
      <div className="text-xs font-medium text-blue-700">
        New contribution account
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[10px] text-muted">
          Account type
          <select
            value={accountType}
            onChange={(e) => {
              const val = e.target.value as AccountCategory;
              setAccountType(val);
              const cfg = getAccountTypeConfig(val);
              if (cfg.supportedTaxTreatments.length === 1)
                setTaxTreatment(
                  cfg.supportedTaxTreatments[0] as typeof taxTreatment,
                );
            }}
            className="block w-full mt-0.5 text-xs border rounded px-1.5 py-1"
          >
            {getAllCategories().map((cat) => (
              <option key={cat} value={cat}>
                {getAccountTypeConfig(cat).displayLabel}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[10px] text-muted">
          Tax treatment
          <select
            value={taxTreatment}
            onChange={(e) =>
              setTaxTreatment(e.target.value as typeof taxTreatment)
            }
            className="block w-full mt-0.5 text-xs border rounded px-1.5 py-1"
          >
            <option value="pre_tax">Pre-Tax</option>
            <option value="tax_free">Tax-Free</option>
            <option value="after_tax">After-Tax</option>
            <option value="hsa">HSA</option>
          </select>
        </label>
        <label className="text-[10px] text-muted">
          Method
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as typeof method)}
            className="block w-full mt-0.5 text-xs border rounded px-1.5 py-1"
          >
            <option value="percent_of_salary">% of salary</option>
            <option value="fixed_per_period">$/period</option>
            <option value="fixed_monthly">$/month</option>
            <option value="fixed_annual">$/year</option>
          </select>
        </label>
        <label className="text-[10px] text-muted">
          Value
          <input
            type="number"
            step="any"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={method === "percent_of_salary" ? "e.g. 6" : "e.g. 500"}
            className="block w-full mt-0.5 text-xs border rounded px-1.5 py-1"
          />
        </label>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button
          onClick={reset}
          className="text-xs text-muted hover:text-secondary px-2 py-0.5"
        >
          Cancel
        </button>
        <button
          onClick={() => {
            if (!value || Number(value) === 0) return;
            onCreateContrib({
              personId,
              jobId,
              accountType,
              taxTreatment,
              contributionMethod: method,
              contributionValue: value,
              employerMatchType: "none",
              isActive: true,
            });
            reset();
          }}
          className="text-xs bg-blue-600 text-white rounded px-3 py-0.5 hover:bg-blue-700"
        >
          Add
        </button>
      </div>
    </div>
  );
}
