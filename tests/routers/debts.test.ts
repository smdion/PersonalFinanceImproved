/** Debts list (Liabilities): payoff estimates, paid-off history, and the
 *  shared other-liabilities figure (net worth reads the same). */
import "./setup-mocks";
import { describe, it, expect } from "vitest";
import { createTestCaller, adminSession, viewerSession } from "./setup";
import * as schema from "@/lib/db/schema-sqlite";
import { getEffectiveOtherLiabilities } from "@/server/helpers/debts";

const loan = {
  name: "Student loans",
  kind: "student_loan" as const,
  ownerPersonId: null,
  balance: "20000",
  balanceAsOf: "2026-01-31",
  interestRate: "0.055",
  monthlyPayment: "217.06", // the 10-year payment, rounded up a cent
};

describe("debts router", () => {
  it("lists a debt with its payoff month counted from the balance's date", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      await caller.debts.create(loan);
      const [d] = await caller.debts.list();
      expect(d).toMatchObject({
        name: "Student loans",
        balance: 20000,
        interestRate: 0.055,
        open: true,
        never: false,
        months: 120,
        payoffMonth: "2036-01",
      });
    } finally {
      cleanup();
    }
  });

  it("flags a payment that never pays it off, and no estimate without a payment", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      await caller.debts.create({
        ...loan,
        name: "Card",
        kind: "credit_card",
        balance: "5000",
        interestRate: "0.22",
        monthlyPayment: "50",
      });
      await caller.debts.create({
        ...loan,
        name: "No payment",
        monthlyPayment: null,
      });
      const list = await caller.debts.list();
      expect(list.find((d) => d.name === "Card")).toMatchObject({
        never: true,
        payoffMonth: null,
      });
      expect(list.find((d) => d.name === "No payment")).toMatchObject({
        never: false,
        payoffMonth: null,
      });
    } finally {
      cleanup();
    }
  });

  it("refuses a rate typed as a percent", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      await expect(
        caller.debts.create({ ...loan, interestRate: "6.5" }),
      ).rejects.toThrow(/fraction/);
    } finally {
      cleanup();
    }
  });

  it("a paid-off debt stays as history with its last balance, and leaves the total", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      const d = await caller.debts.create(loan);
      expect((await caller.debts.summary()).itemized).toBe(20000);
      await caller.debts.markPaidOff({ id: d!.id, date: "2026-03-01" });
      const [after] = await caller.debts.list();
      expect(after).toMatchObject({
        open: false,
        balance: 20000,
        paidOffDate: "2026-03-01",
      });
      expect((await caller.debts.summary()).itemized).toBe(0);
      // Clearing the payoff date reopens it at that balance, not $0.
      await caller.debts.update({ id: d!.id, paidOffDate: null });
      expect((await caller.debts.summary()).itemized).toBe(20000);
    } finally {
      cleanup();
    }
  });

  it("as of a past Dec 31 (finalizing that year), a debt paid off since still counts", async () => {
    const { caller, rawDb, cleanup } = await createTestCaller(adminSession);
    try {
      const d = await caller.debts.create(loan);
      await caller.debts.markPaidOff({ id: d!.id, date: "2026-02-15" });
      const at = (asOf: Date) =>
        getEffectiveOtherLiabilities(rawDb, { asOf }).then((r) => r.itemized);
      expect(await at(new Date(2025, 11, 31))).toBe(20000);
      expect(await at(new Date(2026, 11, 31))).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("a person who owns a debt can't be deleted — a clear message, not a foreign-key error", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      const p = await caller.settings.people.create({
        name: "Pat",
        dateOfBirth: "1990-05-01",
      });
      const d = await caller.debts.create({ ...loan, ownerPersonId: p!.id });
      await expect(
        caller.settings.people.delete({ id: p!.id }),
      ).rejects.toThrow(/own Student loans on Liabilities/);
      await caller.debts.update({ id: d!.id, ownerPersonId: null });
      await caller.settings.people.delete({ id: p!.id });
    } finally {
      cleanup();
    }
  });

  it("net worth's other liabilities = the typed figure + open debts, and reports both parts", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      db.insert(schema.appSettings)
        .values({ key: "current_other_liabilities", value: 1500 })
        .run();
      await caller.debts.create(loan);
      const nw = await caller.networth.computeSummary();
      expect(nw?.otherLiabilities).toBe(21500);
      expect(nw?.otherLiabilitiesParts).toEqual({
        manual: 1500,
        itemized: 20000,
        creditCardMapped: 0,
      });
      expect(await caller.debts.summary()).toMatchObject({ total: 21500 });
    } finally {
      cleanup();
    }
  });

  it("only an admin can change debts; anyone signed in can read them", async () => {
    const { caller, cleanup } = await createTestCaller(viewerSession);
    try {
      expect(await caller.debts.list()).toEqual([]);
      await expect(caller.debts.create(loan)).rejects.toThrow();
    } finally {
      cleanup();
    }
  });
});
