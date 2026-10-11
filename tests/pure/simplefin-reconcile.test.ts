/** Transaction window reconciliation. Invented rows only. */
import { describe, it, expect } from "vitest";
import {
  planReconcile,
  type IncomingTransaction,
  type StoredTransaction,
} from "@/lib/pure/simplefin-reconcile";

const t = (
  externalId: string,
  posted: string,
  amount: number,
  description = "CONTRIBUTION",
  pending = false,
): IncomingTransaction => ({
  externalId,
  posted,
  amount,
  description,
  pending,
});

const s = (
  id: number,
  row: IncomingTransaction,
  voided = false,
): StoredTransaction => ({ ...row, id, voided });

const base = { windowStart: "2026-05-01", accountHasError: false };

describe("planReconcile", () => {
  it("inserts new rows and leaves unchanged ones alone", () => {
    const plan = planReconcile({
      ...base,
      incoming: [t("a", "2026-05-10", 100), t("b", "2026-05-11", 50)],
      stored: [s(1, t("a", "2026-05-10", 100))],
    });
    expect(plan.inserts.map((r) => r.externalId)).toEqual(["b"]);
    expect(plan.updates).toEqual([]);
    expect(plan.voids).toEqual([]);
  });

  it("updates a row whose amount changed", () => {
    const plan = planReconcile({
      ...base,
      incoming: [t("a", "2026-05-10", 101)],
      stored: [s(1, t("a", "2026-05-10", 100))],
    });
    expect(plan.updates).toEqual([{ id: 1, next: t("a", "2026-05-10", 101) }]);
  });

  it("voids a pending row that posted under a new id — one-to-one with equal same-day rows", () => {
    const plan = planReconcile({
      ...base,
      incoming: [
        t("p1-posted", "2026-05-12", 60),
        t("p2-posted", "2026-05-12", 60),
        t("other", "2026-05-12", 40),
      ],
      stored: [
        s(1, t("p1", "2026-05-10", 60, "CONTRIBUTION", true)),
        s(2, t("p2", "2026-05-10", 60, "CONTRIBUTION", true)),
        s(3, t("p3", "2026-05-10", 60, "CONTRIBUTION", true)),
      ],
    });
    // Two posted rows replace exactly two pending rows; the third is left
    // for the general "missing" rule below (still inside the window).
    expect(plan.voids.slice(0, 2).sort()).toEqual([1, 2]);
    expect(plan.inserts).toHaveLength(3);
  });

  it("never voids when the response named the account in an error", () => {
    const plan = planReconcile({
      ...base,
      accountHasError: true,
      incoming: [],
      stored: [s(1, t("a", "2026-05-10", 100))],
    });
    expect(plan.voids).toEqual([]);
  });

  it("never voids rows from the first day of the window or earlier", () => {
    const plan = planReconcile({
      ...base,
      incoming: [],
      stored: [
        s(1, t("edge", "2026-05-01", 100)),
        s(2, t("old", "2026-04-20", 100)),
      ],
    });
    expect(plan.voids).toEqual([]);
  });

  it("soft-voids a row that vanished from inside the window", () => {
    const plan = planReconcile({
      ...base,
      incoming: [t("keep", "2026-05-10", 100)],
      stored: [
        s(1, t("keep", "2026-05-10", 100)),
        s(2, t("gone", "2026-05-09", 30)),
      ],
    });
    expect(plan.voids).toEqual([2]);
  });

  it("refuses to void more than the cap and warns instead", () => {
    const stored = Array.from({ length: 12 }, (_, i) =>
      s(i + 1, t(`x${i}`, "2026-05-10", 10 + i)),
    );
    const plan = planReconcile({ ...base, incoming: [], stored });
    expect(plan.voids).toEqual([]);
    expect(plan.warnings[0]).toMatch(/more than the 5 allowed/);
  });

  it("restores a voided row that reappears", () => {
    const plan = planReconcile({
      ...base,
      incoming: [t("a", "2026-05-10", 100)],
      stored: [s(1, t("a", "2026-05-10", 100), true)],
    });
    expect(plan.updates).toEqual([{ id: 1, next: t("a", "2026-05-10", 100) }]);
  });
});
