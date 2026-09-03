"use client";

import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { confirm } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";

type LoanForm = {
  name: string;
  isActive: boolean;
  refinancedFromId: number | null;
  principalAndInterest: string;
  pmi: string;
  insuranceAndTaxes: string;
  totalEscrow: string;
  interestRate: string;
  termYears: string;
  originalLoanAmount: string;
  firstPaymentDate: string;
  propertyValuePurchase: string;
  propertyValueEstimated: string;
  usePurchaseOrEstimated: string;
};

const emptyLoan: LoanForm = {
  name: "",
  isActive: true,
  refinancedFromId: null,
  principalAndInterest: "",
  pmi: "0",
  insuranceAndTaxes: "0",
  totalEscrow: "0",
  interestRate: "",
  termYears: "30",
  originalLoanAmount: "",
  firstPaymentDate: "",
  propertyValuePurchase: "",
  propertyValueEstimated: "",
  usePurchaseOrEstimated: "purchase",
};

type ExtraPaymentForm = {
  loanId: number;
  paymentDate: string;
  startDate: string;
  endDate: string;
  amount: string;
  isActual: boolean;
  notes: string;
  isRange: boolean;
};

function LoanFormFields({
  form,
  setForm,
  allLoans,
  editId,
}: {
  form: LoanForm;
  setForm: (f: LoanForm) => void;
  allLoans: { id: number; name: string }[];
  editId?: number;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
      <div>
        <label className="text-muted mb-1 block text-xs">Loan Name</label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="e.g. Primary 30yr"
          className="w-full rounded border px-2 py-1"
        />
      </div>
      <div>
        <label className="text-muted mb-1 block text-xs">
          Interest Rate (decimal, e.g. 0.065)
        </label>
        <input
          type="text"
          value={form.interestRate}
          onChange={(e) => setForm({ ...form, interestRate: e.target.value })}
          placeholder="0.065"
          className="w-full rounded border px-2 py-1"
        />
      </div>
      <div>
        <label className="text-muted mb-1 block text-xs">Term (years)</label>
        <input
          type="number"
          value={form.termYears}
          onChange={(e) => setForm({ ...form, termYears: e.target.value })}
          className="w-full rounded border px-2 py-1"
        />
      </div>
      <div>
        <label className="text-muted mb-1 block text-xs">
          Original Loan Amount
        </label>
        <input
          type="text"
          value={form.originalLoanAmount}
          onChange={(e) =>
            setForm({ ...form, originalLoanAmount: e.target.value })
          }
          placeholder="280000"
          className="w-full rounded border px-2 py-1"
        />
      </div>
      <div>
        <label className="text-muted mb-1 block text-xs">Monthly P&I</label>
        <input
          type="text"
          value={form.principalAndInterest}
          onChange={(e) =>
            setForm({ ...form, principalAndInterest: e.target.value })
          }
          placeholder="1770.09"
          className="w-full rounded border px-2 py-1"
        />
      </div>
      <div>
        <label className="text-muted mb-1 block text-xs">
          First Payment Date
        </label>
        <input
          type="date"
          value={form.firstPaymentDate}
          onChange={(e) =>
            setForm({ ...form, firstPaymentDate: e.target.value })
          }
          className="w-full rounded border px-2 py-1"
        />
      </div>
      <div>
        <label className="text-muted mb-1 block text-xs">PMI</label>
        <input
          type="text"
          value={form.pmi}
          onChange={(e) => setForm({ ...form, pmi: e.target.value })}
          className="w-full rounded border px-2 py-1"
        />
      </div>
      <div>
        <label className="text-muted mb-1 block text-xs">
          Insurance & Taxes
        </label>
        <input
          type="text"
          value={form.insuranceAndTaxes}
          onChange={(e) =>
            setForm({ ...form, insuranceAndTaxes: e.target.value })
          }
          className="w-full rounded border px-2 py-1"
        />
      </div>
      <div>
        <label className="text-muted mb-1 block text-xs">Total Escrow</label>
        <input
          type="text"
          value={form.totalEscrow}
          onChange={(e) => setForm({ ...form, totalEscrow: e.target.value })}
          className="w-full rounded border px-2 py-1"
        />
      </div>
      <div>
        <label className="text-muted mb-1 block text-xs">Purchase Value</label>
        <input
          type="text"
          value={form.propertyValuePurchase}
          onChange={(e) =>
            setForm({ ...form, propertyValuePurchase: e.target.value })
          }
          className="w-full rounded border px-2 py-1"
        />
      </div>
      <div>
        <label className="text-muted mb-1 block text-xs">Estimated Value</label>
        <input
          type="text"
          value={form.propertyValueEstimated}
          onChange={(e) =>
            setForm({ ...form, propertyValueEstimated: e.target.value })
          }
          className="w-full rounded border px-2 py-1"
        />
      </div>
      <div>
        <label className="text-muted mb-1 block text-xs">Refinanced From</label>
        <select
          value={form.refinancedFromId ?? ""}
          onChange={(e) =>
            setForm({
              ...form,
              refinancedFromId: e.target.value ? Number(e.target.value) : null,
            })
          }
          className="w-full rounded border px-2 py-1"
        >
          <option value="">None (original loan)</option>
          {allLoans
            .filter((l) => l.id !== editId)
            .map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
        </select>
      </div>
      <div className="flex items-end">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            className="rounded"
          />
          Active
        </label>
      </div>
    </div>
  );
}

export function MortgageSettings() {
  const user = useUser();
  const admin = isAdmin(user);
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.mortgage.mortgageLoans.list.useQuery();
  const { data: extraPayments } =
    trpc.mortgage.mortgageExtraPayments.list.useQuery();
  const createLoan = trpc.mortgage.mortgageLoans.create.useMutation({
    onSuccess: () => {
      utils.mortgage.mortgageLoans.invalidate();
      setAdding(false);
    },
  });
  const updateLoan = trpc.mortgage.mortgageLoans.update.useMutation({
    onSuccess: () => {
      utils.mortgage.mortgageLoans.invalidate();
      setEditingId(null);
    },
  });
  const deleteLoan = trpc.mortgage.mortgageLoans.delete.useMutation({
    onSuccess: () => utils.mortgage.mortgageLoans.invalidate(),
  });
  const createExtra = trpc.mortgage.mortgageExtraPayments.create.useMutation({
    onSuccess: () => {
      utils.mortgage.mortgageExtraPayments.invalidate();
      setAddingExtra(false);
    },
  });
  const deleteExtra = trpc.mortgage.mortgageExtraPayments.delete.useMutation({
    onSuccess: () => utils.mortgage.mortgageExtraPayments.invalidate(),
  });

  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<LoanForm>(emptyLoan);
  const [addingExtra, setAddingExtra] = useState(false);
  const [extraForm, setExtraForm] = useState<ExtraPaymentForm>({
    loanId: 0,
    paymentDate: "",
    startDate: "",
    endDate: "",
    amount: "",
    isActual: false,
    notes: "",
    isRange: false,
  });

  if (isLoading)
    return <div className="text-muted">Loading mortgage loans...</div>;

  const loans = data ?? [];
  const allLoansRef = loans.map((l) => ({ id: l.id, name: l.name }));

  const startEdit = (loan: (typeof loans)[0]) => {
    setEditingId(loan.id);
    setForm({
      name: loan.name,
      isActive: loan.isActive,
      refinancedFromId: loan.refinancedFromId ?? null,
      principalAndInterest: loan.principalAndInterest,
      pmi: loan.pmi,
      insuranceAndTaxes: loan.insuranceAndTaxes,
      totalEscrow: loan.totalEscrow,
      interestRate: loan.interestRate,
      termYears: String(loan.termYears),
      originalLoanAmount: loan.originalLoanAmount,
      firstPaymentDate: loan.firstPaymentDate,
      propertyValuePurchase: loan.propertyValuePurchase,
      propertyValueEstimated: loan.propertyValueEstimated ?? "",
      usePurchaseOrEstimated: loan.usePurchaseOrEstimated,
    });
  };

  const handleSave = () => {
    const payload = {
      name: form.name,
      isActive: form.isActive,
      refinancedFromId: form.refinancedFromId,
      principalAndInterest: form.principalAndInterest,
      pmi: form.pmi,
      insuranceAndTaxes: form.insuranceAndTaxes,
      totalEscrow: form.totalEscrow,
      interestRate: form.interestRate,
      termYears: parseInt(form.termYears),
      originalLoanAmount: form.originalLoanAmount,
      firstPaymentDate: form.firstPaymentDate,
      propertyValuePurchase: form.propertyValuePurchase,
      propertyValueEstimated: form.propertyValueEstimated || null,
      usePurchaseOrEstimated: form.usePurchaseOrEstimated,
    };
    if (editingId) {
      updateLoan.mutate({ id: editingId, ...payload });
    } else {
      createLoan.mutate(payload);
    }
  };

  const handleAddExtra = () => {
    if (!extraForm.loanId || !extraForm.amount) return;
    createExtra.mutate({
      loanId: extraForm.loanId,
      paymentDate: extraForm.isRange ? null : extraForm.paymentDate || null,
      startDate: extraForm.isRange ? extraForm.startDate || null : null,
      endDate: extraForm.isRange ? extraForm.endDate || null : null,
      amount: extraForm.amount,
      isActual: extraForm.isActual,
      notes: extraForm.notes || null,
    });
  };

  // Build refinance chain display
  const chainMap = new Map<number, string>();
  for (const l of loans) {
    if (l.refinancedFromId) {
      const from = loans.find((ll) => ll.id === l.refinancedFromId);
      if (from) chainMap.set(from.id, l.name);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Mortgage Loans</h2>
        {admin && (
          <Button
            size="sm"
            onClick={() => {
              setAdding(true);
              setEditingId(null);
              setForm(emptyLoan);
            }}
          >
            + Add Loan
          </Button>
        )}
      </div>

      {/* Refinance chain visualization */}
      {loans.length > 1 && (
        <div className="bg-surface-sunken mb-4 rounded-lg p-3">
          <p className="text-faint mb-2 text-xs tracking-wide uppercase">
            Refinance Chain
          </p>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {loans.map((l) => {
              const refinancedInto = chainMap.get(l.id);
              return (
                <React.Fragment key={l.id}>
                  <span
                    className={`rounded px-2 py-0.5 ${
                      l.isActive
                        ? "bg-green-100 font-medium text-green-800"
                        : "bg-surface-strong text-muted"
                    }`}
                  >
                    {l.name}
                    <span className="text-caption ml-1">
                      ({formatPercent(Number(l.interestRate), 2)}, {l.termYears}
                      yr)
                    </span>
                  </span>
                  {refinancedInto && <span className="text-faint">→</span>}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}

      {/* Add/Edit form */}
      {(adding || editingId) && (
        <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
          <p className="mb-3 text-sm font-medium text-blue-800">
            {editingId ? "Edit Loan" : "New Loan"}
          </p>
          <LoanFormFields
            form={form}
            setForm={setForm}
            allLoans={allLoansRef}
            editId={editingId ?? undefined}
          />
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              onClick={handleSave}
              disabled={
                createLoan.isPending || updateLoan.isPending || !form.name
              }
            >
              {editingId ? "Save" : "Create"}
            </Button>
            <button
              onClick={() => {
                setAdding(false);
                setEditingId(null);
              }}
              className="hover:bg-surface-sunken rounded border px-3 py-1 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Loan cards */}
      {loans.length === 0 ? (
        <p className="text-muted text-sm">No loans configured.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {loans.map((loan) => {
            const refinancedFrom = loan.refinancedFromId
              ? loans.find((l) => l.id === loan.refinancedFromId)
              : null;
            return (
              <div
                key={loan.id}
                className={`rounded border p-4 ${loan.isActive ? "border-green-300 bg-green-50" : ""}`}
              >
                <div className="mb-2 flex items-start justify-between">
                  <h3 className="font-medium">
                    {loan.name}{" "}
                    {loan.isActive ? (
                      <span className="text-xs text-green-600">(Active)</span>
                    ) : (
                      <span className="text-faint text-xs">(Inactive)</span>
                    )}
                  </h3>
                  {admin && (
                    <div className="flex gap-1">
                      <button
                        onClick={() => startEdit(loan)}
                        className="text-xs text-blue-600 hover:text-blue-800"
                      >
                        Edit
                      </button>
                      <button
                        onClick={async () => {
                          if (await confirm(`Delete "${loan.name}"?`))
                            deleteLoan.mutate({ id: loan.id });
                        }}
                        className="text-xs text-red-400 hover:text-red-600"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
                {refinancedFrom && (
                  <p className="text-caption text-muted mb-1">
                    Refinanced from: {refinancedFrom.name}
                  </p>
                )}
                <dl className="grid grid-cols-2 gap-1 text-sm">
                  <dt className="text-muted">P&I</dt>
                  <dd>{formatCurrency(Number(loan.principalAndInterest))}</dd>
                  <dt className="text-muted">Rate</dt>
                  <dd>{formatPercent(Number(loan.interestRate), 3)}</dd>
                  <dt className="text-muted">Term</dt>
                  <dd>{loan.termYears} years</dd>
                  <dt className="text-muted">Original Amount</dt>
                  <dd>{formatCurrency(Number(loan.originalLoanAmount))}</dd>
                  <dt className="text-muted">First Payment</dt>
                  <dd>{loan.firstPaymentDate}</dd>
                  <dt className="text-muted">Purchase Value</dt>
                  <dd>{formatCurrency(Number(loan.propertyValuePurchase))}</dd>
                  {loan.propertyValueEstimated && (
                    <>
                      <dt className="text-muted">Estimated Value</dt>
                      <dd>
                        {formatCurrency(Number(loan.propertyValueEstimated))}
                      </dd>
                    </>
                  )}
                </dl>
              </div>
            );
          })}
        </div>
      )}

      {/* Extra Payments section */}
      <div className="mt-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Extra Payments</h2>
          {admin && (
            <Button
              size="sm"
              onClick={() => {
                setAddingExtra(true);
                setExtraForm({
                  loanId: loans[0]?.id ?? 0,
                  paymentDate: "",
                  startDate: "",
                  endDate: "",
                  amount: "",
                  isActual: false,
                  notes: "",
                  isRange: false,
                });
              }}
            >
              + Add Extra Payment
            </Button>
          )}
        </div>

        {addingExtra && (
          <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
            <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="text-muted mb-1 block text-xs">Loan</label>
                <select
                  value={extraForm.loanId}
                  onChange={(e) =>
                    setExtraForm({
                      ...extraForm,
                      loanId: Number(e.target.value),
                    })
                  }
                  className="w-full rounded border px-2 py-1"
                >
                  {loans.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-muted mb-1 block text-xs">Amount</label>
                <input
                  type="number"
                  value={extraForm.amount}
                  onChange={(e) =>
                    setExtraForm({ ...extraForm, amount: e.target.value })
                  }
                  placeholder="500"
                  className="w-full rounded border px-2 py-1"
                />
              </div>
              <div>
                <label className="text-muted mb-1 flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={extraForm.isRange}
                    onChange={(e) =>
                      setExtraForm({ ...extraForm, isRange: e.target.checked })
                    }
                    className="rounded"
                  />
                  Recurring (date range)
                </label>
                {extraForm.isRange ? (
                  <div className="flex gap-1">
                    <input
                      type="date"
                      value={extraForm.startDate}
                      onChange={(e) =>
                        setExtraForm({
                          ...extraForm,
                          startDate: e.target.value,
                        })
                      }
                      className="flex-1 rounded border px-2 py-1 text-xs"
                    />
                    <input
                      type="date"
                      value={extraForm.endDate}
                      onChange={(e) =>
                        setExtraForm({ ...extraForm, endDate: e.target.value })
                      }
                      className="flex-1 rounded border px-2 py-1 text-xs"
                    />
                  </div>
                ) : (
                  <input
                    type="date"
                    value={extraForm.paymentDate}
                    onChange={(e) =>
                      setExtraForm({
                        ...extraForm,
                        paymentDate: e.target.value,
                      })
                    }
                    className="w-full rounded border px-2 py-1"
                  />
                )}
              </div>
              <div>
                <label className="text-muted mb-1 block text-xs">Notes</label>
                <input
                  type="text"
                  value={extraForm.notes}
                  onChange={(e) =>
                    setExtraForm({ ...extraForm, notes: e.target.value })
                  }
                  className="w-full rounded border px-2 py-1"
                />
                <label className="text-muted mt-1 flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={extraForm.isActual}
                    onChange={(e) =>
                      setExtraForm({ ...extraForm, isActual: e.target.checked })
                    }
                    className="rounded"
                  />
                  Historical (already paid)
                </label>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                onClick={handleAddExtra}
                disabled={createExtra.isPending}
              >
                Add
              </Button>
              <button
                onClick={() => setAddingExtra(false)}
                className="hover:bg-surface-sunken rounded border px-3 py-1 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {extraPayments && extraPayments.length > 0 ? (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-muted border-b text-left">
                <th className="py-1 pr-2">Loan</th>
                <th className="py-1 pr-2">Date</th>
                <th className="py-1 pr-2 text-right">Amount</th>
                <th className="py-1 pr-2">Type</th>
                <th className="py-1 pr-2">Notes</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {extraPayments.map((ep) => {
                const loan = loans.find((l) => l.id === ep.loanId);
                const dateStr = ep.paymentDate
                  ? ep.paymentDate
                  : `${ep.startDate} → ${ep.endDate}`;
                return (
                  <tr key={ep.id} className="border-subtle group border-b">
                    <td className="py-1 pr-2">
                      {loan?.name ?? `Loan #${ep.loanId}`}
                    </td>
                    <td className="py-1 pr-2 text-xs">{dateStr}</td>
                    <td className="py-1 pr-2 text-right">
                      {formatCurrency(Number(ep.amount))}
                    </td>
                    <td className="py-1 pr-2">
                      <span
                        className={`text-caption rounded px-1.5 py-0.5 ${
                          ep.isActual
                            ? "bg-green-100 text-green-700"
                            : "bg-surface-elevated text-muted"
                        }`}
                      >
                        {ep.isActual ? "Historical" : "Planned"}
                      </span>
                    </td>
                    <td className="text-muted py-1 pr-2 text-xs">
                      {ep.notes ?? ""}
                    </td>
                    <td className="py-1">
                      {admin && (
                        <button
                          onClick={async () => {
                            if (await confirm("Delete this extra payment?"))
                              deleteExtra.mutate({ id: ep.id });
                          }}
                          className="text-xs text-red-400 transition-opacity hover:text-red-600 md:opacity-0 md:group-hover:opacity-100"
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="text-muted text-sm">No extra payments configured.</p>
        )}
      </div>
    </div>
  );
}
