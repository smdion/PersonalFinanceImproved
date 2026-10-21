"use client";

import { useMemo, useState } from "react";
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency } from "@/lib/utils/format";
import {
  checkPaystub,
  ledgrCheckFor,
  paystubCheckNumber,
  type FicaRates,
  type PaystubFigures,
  type PaystubFinding,
} from "@/lib/pure/paystub-check";
import { deductionDisplayName } from "./deduction-row";
import type { PaycheckResult } from "./types";

const FIELDS: { key: keyof PaystubFigures; label: string; hint?: string }[] = [
  { key: "gross", label: "Gross pay" },
  {
    key: "federalTaxableWages",
    label: "Federal taxable wages",
    hint: "Often “Fed taxable” or “FWT wages”",
  },
  { key: "federalWithholding", label: "Federal income tax withheld" },
  { key: "socialSecurityWages", label: "Social Security wages" },
  { key: "socialSecurity", label: "Social Security tax" },
  { key: "medicareWages", label: "Medicare wages" },
  { key: "medicare", label: "Medicare tax" },
  { key: "netPay", label: "Net pay" },
];

const STATUS_STYLE: Record<PaystubFinding["status"], string> = {
  match: "text-green-600 dark:text-green-400",
  off: "text-amber-600 dark:text-amber-400",
  skipped: "text-faint",
};
const STATUS_TEXT: Record<PaystubFinding["status"], string> = {
  match: "Matches",
  off: "Off",
  skipped: "Not compared",
};

/**
 * "Check against a pay stub": type one real stub's figures (any of them)
 * and see where Ledgr's paycheck differs and the likely fix. Nothing is
 * saved. A regular check — a bonus check has its own figures.
 */
export function PaystubCheck({
  paycheck,
  rates,
  payPeriod,
  anchor,
}: {
  paycheck: PaycheckResult;
  rates: FicaRates;
  payPeriod: string;
  /** The payday the year schedule is counted from (the job's anchor
   *  payday, else its start date — as the paycheck itself uses). */
  anchor: string;
}) {
  const [open, setOpen] = useState(false);
  const [payDate, setPayDate] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});

  const taxYear = new Date().getFullYear();
  const date = payDate ? new Date(`${payDate}T12:00:00Z`) : null;
  // Ledgr figures this year's checks — its rates and wage base are this
  // year's.
  const otherYear = date !== null && date.getUTCFullYear() !== taxYear;
  const n = paystubCheckNumber(
    date,
    payPeriod,
    anchor,
    paycheck.periodsPerYear,
  );
  const isBonusCheck = paycheck.bonusPeriod === n;
  const result = useMemo(() => {
    if (otherYear) return { findings: [], allMatch: false };
    const stub: PaystubFigures = {};
    for (const f of FIELDS) {
      const v = values[f.key];
      if (v !== undefined && v.trim() !== "" && Number.isFinite(Number(v)))
        stub[f.key] = Number(v);
    }
    return checkPaystub(
      ledgrCheckFor(paycheck, rates, n, deductionDisplayName),
      stub,
    );
  }, [values, paycheck, rates, n, otherYear]);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="text-secondary hover:text-primary flex items-center gap-1.5 text-sm font-medium"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          fill="currentColor"
          className={`text-faint h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`}
        >
          <path d="M5 3l7 5-7 5z" />
        </svg>
        Check against a pay stub
      </button>
      {open && (
        <div className="mt-3 space-y-4">
          <div className="bg-surface-sunken border-subtle space-y-3 rounded-lg border p-4 text-sm">
            <p className="text-caption text-faint">
              Type the figures from one regular check — any you have. Nothing is
              saved.
            </p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <label className="col-span-2 block sm:col-span-1">
                <span className="text-secondary block">Pay date</span>
                <input
                  type="date"
                  aria-label="Stub pay date"
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                  className="bg-surface-primary mt-1 w-full rounded border px-1.5 py-0.5 text-sm"
                />
                <span className="text-caption text-faint block">
                  {otherYear
                    ? "Not this year"
                    : `Check ${n} of ${paycheck.periodsPerYear}${payDate ? "" : " (latest so far)"}`}
                </span>
              </label>
              {FIELDS.map((f) => (
                <label key={f.key} className="block">
                  <span className="text-secondary block">{f.label}</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    aria-label={`Stub ${f.label}`}
                    value={values[f.key] ?? ""}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, [f.key]: e.target.value }))
                    }
                    placeholder="—"
                    className="bg-surface-primary mt-1 w-full rounded border px-1.5 py-0.5 text-right text-sm tabular-nums"
                  />
                  {f.hint && (
                    <span className="text-caption text-faint block">
                      {f.hint}
                    </span>
                  )}
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-2 text-sm">
            {isBonusCheck && (
              <p className="text-caption text-amber-600 dark:text-amber-400">
                Your bonus is paid on this date. If this stub includes it,
                compare a regular check instead.
              </p>
            )}
            {otherYear && (
              <p className="text-caption text-amber-600 dark:text-amber-400">
                Ledgr figures {taxYear}&apos;s checks — enter a stub from{" "}
                {taxYear}.
              </p>
            )}
            {result.findings.length === 0 ? (
              <p className="text-faint">
                Enter a figure from your stub to compare.
                <HelpTip text="Ledgr compares each figure with its own for the same check, and says what most likely explains a difference — a deduction taxed differently, a taxable benefit, or the W-4." />
              </p>
            ) : (
              <>
                {result.allMatch && (
                  <p className="font-medium text-green-600 dark:text-green-400">
                    Matches your stub.
                  </p>
                )}
                <ul className="space-y-2">
                  {result.findings.map((f) => (
                    <li key={f.key}>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-secondary">{f.label}</span>
                        <span
                          className={`text-caption font-medium ${STATUS_STYLE[f.status]}`}
                        >
                          {STATUS_TEXT[f.status]}
                        </span>
                      </div>
                      <div className="text-caption text-faint tabular-nums">
                        Stub {f.stub === null ? "—" : formatCurrency(f.stub)} ·
                        Ledgr {formatCurrency(f.ledgr)}
                      </div>
                      {f.note && (
                        <p className="text-caption text-muted mt-0.5">
                          {f.note}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
