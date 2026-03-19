"use client";

import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { confirm } from "@/components/ui/confirm-dialog";

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
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
      <div>
        <label className="block text-xs text-muted mb-1">Loan Name</label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="e.g. Primary 30yr"
          className="w-full border rounded px-2 py-1"
        />
      </div>
      <div>
        <label className="block text-xs text-muted mb-1">
          Interest Rate (decimal, e.g. 0.065)
        </label>
        <input
          type="text"
          value={form.interestRate}
          onChange={(e) => setForm({ ...form, interestRate: e.target.value })}
          placeholder="0.065"
          className="w-full border rounded px-2 py-1"
        />
      </div>
      <div>
        <label className="block text-xs text-muted mb-1">Term (years)</label>
        <input
          type="number"
          value={form.termYears}
          onChange={(e) => setForm({ ...form, termYears: e.target.value })}
          className="w-full border rounded px-2 py-1"
        />
      </div>
      <div>
        <label className="block text-xs text-muted mb-1">
          Original Loan Amount
        </label>
        <input
          type="text"
          value={form.originalLoanAmount}
          onChange={(e) =>
            setForm({ ...form, originalLoanAmount: e.target.value })
          }
          placeholder="280000"
          className="w-full border rounded px-2 py-1"
        />
      </div>
      <div>
        <label className="block text-xs text-muted mb-1">Monthly P&I</label>
        <input
          type="text"
          value={form.principalAndInterest}
          onChange={(e) =>
            setForm({ ...form, principalAndInterest: e.target.value })
          }
          placeholder="1770.09"
          className="w-full border rounded px-2 py-1"
        />
      </div>
      <div>
        <label className="block text-xs text-muted mb-1">
          First Payment Date
        </label>
        <input
          type="date"
          value={form.firstPaymentDate}
          onChange={(e) =>
            setForm({ ...form, firstPaymentDate: e.target.value })
          }
          className="w-full border rounded px-2 py-1"
        />
      </div>
      <div>
        <label className="block text-xs text-muted mb-1">PMI</label>
        <input
          type="text"
          value={form.pmi}
          onChange={(e) => setForm({ ...form, pmi: e.target.value })}
          className="w-full border rounded px-2 py-1"
        />
      </div>
      <div>
        <label className="block text-xs text-muted mb-1">
          Insurance & Taxes
        </label>
        <input
          type="text"
          value={form.insuranceAndTaxes}
          onChange={(e) =>
            setForm({ ...form, insuranceAndTaxes: e.target.value })
          }
          className="w-full border rounded px-2 py-1"
        />
      </div>
      <div>
        <label className="block text-xs text-muted mb-1">Total Escrow</label>
        <input
          type="text"
          value={form.totalEscrow}
          onChange={(e) => setForm({ ...form, totalEscrow: e.target.value })}
          className="w-full border rounded px-2 py-1"
        />
      </div>
      <div>
        <label className="block text-xs text-muted mb-1">Purchase Value</label>
        <input
          type="text"
          value={form.propertyValuePurchase}
          onChange={(e) =>
            setForm({ ...form, propertyValuePurchase: e.target.value })
          }
          className="w-full border rounded px-2 py-1"
        />
      </div>
      <div>
        <label className="block text-xs text-muted mb-1">Estimated Value</label>
        <input
          type="text"
          value={form.propertyValueEstimated}
          onChange={(e) =>
            setForm({ ...form, propertyValueEstimated: e.target.value })
          }
          className="w-full border rounded px-2 py-1"
        />
      </div>
      <div>
        <label className="block text-xs text-muted mb-1">Refinanced From</label>
        <select
          value={form.refinancedFromId ?? ""}
          onChange={(e) =>
            setForm({
              ...form,
              refinancedFromId: e.target.value ? Number(e.target.value) : null,
            })
          }
          className="w-full border rounded px-2 py-1"
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
  const { data, isLoading } = trpc.settings.mortgageLoans.list.useQuery();
  const { data: extraPayments } =
    trpc.settings.mortgageExtraPayments.list.useQuery();
  const createLoan = trpc.settings.mortgageLoans.create.useMutation({
    onSuccess: () => {
      utils.settings.mortgageLoans.invalidate();
      setAdding(false);
    },
  });
  const updateLoan = trpc.settings.mortgageLoans.update.useMutation({
    onSuccess: () => {
      utils.settings.mortgageLoans.invalidate();
      setEditingId(null);
    },
  });
  const deleteLoan = trpc.settings.mortgageLoans.delete.useMutation({
    onSuccess: () => utils.settings.mortgageLoans.invalidate(),
  });
  const createExtra = trpc.settings.mortgageExtraPayments.create.useMutation({
    onSuccess: () => {
      utils.settings.mortgageExtraPayments.invalidate();
      setAddingExtra(false);
    },
  });
  const deleteExtra = trpc.settings.mortgageExtraPayments.delete.useMutation({
    onSuccess: () => utils.settings.mortgageExtraPayments.invalidate(),
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
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Mortgage Loans</h2>
        {admin && (
          <button
            onClick={() => {
              setAdding(true);
              setEditingId(null);
              setForm(emptyLoan);
            }}
            className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
          >
            + Add Loan
          </button>
        )}
      </div>

      {/* Refinance chain visualization */}
      {loans.length > 1 && (
        <div className="mb-4 bg-surface-sunken rounded-lg p-3">
          <p className="text-xs text-faint uppercase tracking-wide mb-2">
            Refinance Chain
          </p>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {loans.map((l) => {
              const refinancedInto = chainMap.get(l.id);
              return (
                <React.Fragment key={l.id}>
                  <span
                    className={`px-2 py-0.5 rounded ${
                      l.isActive
                        ? "bg-green-100 text-green-800 font-medium"
                        : "bg-surface-strong text-muted"
                    }`}
                  >
                    {l.name}
                    <span className="text-[10px] ml-1">
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
        <div className="mb-6 border border-blue-200 bg-blue-50 rounded-lg p-4">
          <p className="text-sm font-medium text-blue-800 mb-3">
            {editingId ? "Edit Loan" : "New Loan"}
          </p>
          <LoanFormFields
            form={form}
            setForm={setForm}
            allLoans={allLoansRef}
            editId={editingId ?? undefined}
          />
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleSave}
              disabled={
                createLoan.isPending || updateLoan.isPending || !form.name
              }
              className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {editingId ? "Save" : "Create"}
            </button>
            <button
              onClick={() => {
                setAdding(false);
                setEditingId(null);
              }}
              className="px-3 py-1 border rounded text-sm hover:bg-surface-sunken"
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
                className={`border rounded p-4 ${loan.isActive ? "border-green-300 bg-green-50" : ""}`}
              >
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-medium">
                    {loan.name}{" "}
                    {loan.isActive ? (
                      <span className="text-green-600 text-xs">(Active)</span>
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
                  <p className="text-[10px] text-muted mb-1">
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
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Extra Payments</h2>
          {admin && (
            <button
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
              className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
            >
              + Add Extra Payment
            </button>
          )}
        </div>

        {addingExtra && (
          <div className="mb-4 border border-blue-200 bg-blue-50 rounded-lg p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
              <div>
                <label className="block text-xs text-muted mb-1">Loan</label>
                <select
                  value={extraForm.loanId}
                  onChange={(e) =>
                    setExtraForm({
                      ...extraForm,
                      loanId: Number(e.target.value),
                    })
                  }
                  className="w-full border rounded px-2 py-1"
                >
                  {loans.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Amount</label>
                <input
                  type="number"
                  value={extraForm.amount}
                  onChange={(e) =>
                    setExtraForm({ ...extraForm, amount: e.target.value })
                  }
                  placeholder="500"
                  className="w-full border rounded px-2 py-1"
                />
              </div>
              <div>
                <label className="flex items-center gap-2 text-xs text-muted mb-1">
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
                      className="flex-1 border rounded px-2 py-1 text-xs"
                    />
                    <input
                      type="date"
                      value={extraForm.endDate}
                      onChange={(e) =>
                        setExtraForm({ ...extraForm, endDate: e.target.value })
                      }
                      className="flex-1 border rounded px-2 py-1 text-xs"
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
                    className="w-full border rounded px-2 py-1"
                  />
                )}
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Notes</label>
                <input
                  type="text"
                  value={extraForm.notes}
                  onChange={(e) =>
                    setExtraForm({ ...extraForm, notes: e.target.value })
                  }
                  className="w-full border rounded px-2 py-1"
                />
                <label className="flex items-center gap-1.5 mt-1 text-xs text-muted">
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
            <div className="flex gap-2 mt-3">
              <button
                onClick={handleAddExtra}
                disabled={createExtra.isPending}
                className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
              >
                Add
              </button>
              <button
                onClick={() => setAddingExtra(false)}
                className="px-3 py-1 border rounded text-sm hover:bg-surface-sunken"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {extraPayments && extraPayments.length > 0 ? (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b text-left text-muted">
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
                  <tr key={ep.id} className="border-b border-subtle group">
                    <td className="py-1 pr-2">
                      {loan?.name ?? `Loan #${ep.loanId}`}
                    </td>
                    <td className="py-1 pr-2 text-xs">{dateStr}</td>
                    <td className="py-1 pr-2 text-right">
                      {formatCurrency(Number(ep.amount))}
                    </td>
                    <td className="py-1 pr-2">
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded ${
                          ep.isActual
                            ? "bg-green-100 text-green-700"
                            : "bg-surface-elevated text-muted"
                        }`}
                      >
                        {ep.isActual ? "Historical" : "Planned"}
                      </span>
                    </td>
                    <td className="py-1 pr-2 text-xs text-muted">
                      {ep.notes ?? ""}
                    </td>
                    <td className="py-1">
                      {admin && (
                        <button
                          onClick={async () => {
                            if (await confirm("Delete this extra payment?"))
                              deleteExtra.mutate({ id: ep.id });
                          }}
                          className="text-xs text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
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
