/**
 * A debit taken from account parts by balance (debit-by-balance.ts): the
 * parts give exactly the amount, and cents their rounded-up shares
 * overshoot come back only to parts that gave, so a $0 part takes none.
 * Its callers: a Roth conversion's Traditional parts and an owner's QCD.
 */
import { describe, expect, it, vi } from "vitest";

type Point = { point: string; gap: number };
const points = vi.hoisted(() => [] as Point[]);
vi.mock(
  "@/lib/pure/engine/projection-year-handlers/settle",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/lib/pure/engine/projection-year-handlers/settle")
      >();
    return {
      ...actual,
      settle: (...args: Parameters<typeof actual.settle>) => {
        const [, state, point] = args;
        const b = actual.taxBucketsOf(state.accountBalance);
        let gap = b.preTax + b.taxFree + b.hsa + b.afterTax;
        for (const held of state.indBalance.values()) gap -= held;
        points.push({ point, gap: Math.round(gap * 100) });
        actual.settle(...args);
      },
    };
  },
);

// Each owner's QCD is the case's amount, so its rounded shares miss it.
const qcd = vi.hoisted(() => ({ amount: 0 }));
vi.mock("@/lib/pure/engine/qcd", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pure/engine/qcd")>();
  return {
    ...actual,
    computeQcdAmounts: (...args: Parameters<typeof actual.computeQcdAmounts>) =>
      actual
        .computeQcdAmounts(...args)
        .map((person) => ({ ...person, qcdAmount: qcd.amount })),
  };
});

import { calculateProjection } from "@/lib/pure/engine";
import type { AccountCategory } from "@/lib/config/account-types";
import type { IndividualAccountInput } from "@/lib/pure/accounts/account-balances.types";
import { debitByBalance } from "@/lib/pure/engine/individual-accounts/debit-by-balance";
import { debitConvertedParts } from "@/lib/pure/engine/individual-accounts/conversion";
import { makeIndKey } from "@/lib/pure/engine/individual-accounts/ledger";
import { makeIndividualAccount } from "../fixtures/engine-fixtures";
import { acct, household } from "../fixtures/two-person-household";

const indKey = makeIndKey();
const cents = (x: number) => Math.round(x * 100);

/** Traditional IRA parts at these balances, each with its Roth part at $0. */
function iraParts(balances: number[]) {
  const accounts = balances.flatMap((startingBalance, i) =>
    (["preTax", "taxFree"] as const).map((taxType) =>
      makeIndividualAccount({
        name: `IRA ${i + 1}`,
        category: "ira",
        taxType,
        startingBalance: taxType === "preTax" ? startingBalance : 0,
      }),
    ),
  );
  const balanceMap = new Map(
    accounts.map((ia) => [indKey(ia), ia.startingBalance]),
  );
  const traditional = accounts.filter((ia) => ia.taxType === "preTax");
  const roth = accounts.filter((ia) => ia.taxType === "taxFree");
  const sum = (parts: IndividualAccountInput[]) =>
    parts.reduce((s, ia) => s + balanceMap.get(indKey(ia))!, 0);
  return { accounts, balanceMap, traditional, roth, sum };
}

describe("debitByBalance", () => {
  it.each([
    { label: "two equal parts", balances: [1000, 1000], gave: [50, 50.01] },
    {
      label: "a $0 part first",
      balances: [0, 1000, 1000],
      gave: [0, 50, 50.01],
    },
  ])(
    "$label give exactly the amount when their rounded shares overshoot",
    ({ balances, gave }) => {
      const { balanceMap, traditional, sum } = iraParts(balances);
      debitByBalance(
        { balances: balanceMap, keyOf: indKey },
        traditional,
        100.01,
      );
      expect(cents(sum(traditional))).toBe(cents(2000 - 100.01));
      expect(
        traditional.map((ia, i) =>
          Number((balances[i]! - balanceMap.get(indKey(ia))!).toFixed(2)),
        ),
      ).toEqual(gave);
    },
  );

  // $100 in thirds is 99.99: the cent left comes from the first part with
  // money, never the $0 part, where it would be lost.
  it("a $0 part first leaves the cents short to the next part with money", () => {
    const balances = [0, 1000, 1000, 1000];
    const { balanceMap, traditional, sum } = iraParts(balances);
    debitByBalance({ balances: balanceMap, keyOf: indKey }, traditional, 100);
    expect(cents(sum(traditional))).toBe(cents(3000 - 100));
    expect(
      traditional.map((ia, i) =>
        Number((balances[i]! - balanceMap.get(indKey(ia))!).toFixed(2)),
      ),
    ).toEqual([0, 33.34, 33.33, 33.33]);
  });

  it.each([
    { balances: [0, 1000, 1000], amount: 100.01 },
    { balances: [0, 1000, 1000, 1000], amount: 100 },
  ])(
    "a conversion's Roth parts take what their Traditional parts gave ($amount)",
    ({ balances, amount }) => {
      const { accounts, balanceMap, traditional, roth, sum } =
        iraParts(balances);
      const held = balances.reduce((s, b) => s + b, 0);
      debitConvertedParts(
        { accounts, balances: balanceMap, keyOf: indKey, basis: new Map() },
        new Map<AccountCategory, number>([["ira", amount]]),
      );
      expect(cents(sum(traditional))).toBe(cents(held - amount));
      expect(cents(sum(roth))).toBe(cents(amount));
      expect(balanceMap.get(indKey(roth[0]!))).toBe(0);
    },
  );
});

describe("a QCD over an owner's IRA parts", () => {
  it.each([
    { label: "overshoot", amount: 100.01, ira: [250000, 250000] },
    { label: "fall short", amount: 100, ira: [0, 250000, 250000, 250000] },
  ])(
    "whose shares $label leaves the categories' and parts' money gap unmoved",
    ({ amount, ira }) => {
      qcd.amount = amount;
      points.length = 0;
      calculateProjection(
        household(
          [
            ...ira.map((balance, i) =>
              acct(`Ann IRA ${i + 1}`, "ira", balance, 1),
            ),
            acct("Bo 401k", "401k", 500000, 2),
          ],
          {
            annualExpenses: 1000,
            decumulationAnnualExpenses: 1000,
            socialSecurityEntries: [1, 2].map((personId) => ({
              personId,
              personName: personId === 1 ? "Ann" : "Bo",
              birthYear: personId === 1 ? 1948 : 1950,
              startAge: 70,
              annualAmount: 0,
            })),
            perPersonBirthYears: [1948, 1950],
            projectionEndYear: 2045,
          },
          { qcdMaximize: true },
        ),
      );
      const atQcd = points.filter((p) => p.point === "decumulation.qcd");
      expect(atQcd.length).toBeGreaterThan(10);
      expect(atQcd.map((p) => p.gap).filter((gap) => gap !== 0)).toEqual([]);
    },
  );
});
