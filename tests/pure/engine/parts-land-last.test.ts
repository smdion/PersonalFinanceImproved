/**
 * Within each flow the account parts land last: when growth, a draw's
 * deduction or a basis take-out reads the categories, the parts still hold
 * what the categories hold (each slice and each basis category against its
 * parts' sum, to the cent). The parts then land in the run's own maps.
 */
import { describe, it, expect, vi } from "vitest";
import fc from "fast-check";

type Run = {
  ctx: {
    indAccounts: readonly { category: string; taxType: string }[];
    indKey: (part: never) => string;
  };
  state: {
    accountBalance: Record<string, Record<string, unknown>>;
    indBalance: Map<string, number>;
    brokBasis: Map<string, number>;
  };
};
const seen = vi.hoisted(() => ({
  run: undefined as Run | undefined,
  entries: new Map<string, number>(),
  apart: [] as string[],
}));
/** Each slice's balance (and each basis category's basis) less its parts'
 *  sum, in cents, where it isn't 0. */
const apartNow = vi.hoisted(() => (run: Run, what: "balance" | "basis") => {
  const { indAccounts, indKey } = run.ctx;
  const { accountBalance, indBalance, brokBasis } = run.state;
  const cents = new Map<string, number>();
  const add = (key: string, amount: number) =>
    cents.set(key, (cents.get(key) ?? 0) + Math.round(amount * 100));
  for (const [category, b] of Object.entries(accountBalance)) {
    if (what === "basis") {
      if (b.structure === "basis_tracking") add(category, Number(b.basis));
    } else if (b.structure === "roth_traditional") {
      add(`${category}:traditional`, Number(b.traditional));
      add(`${category}:roth`, Number(b.roth));
    } else add(`${category}:balance`, Number(b.balance));
  }
  for (const part of indAccounts) {
    const key = indKey(part as never);
    const b = accountBalance[part.category];
    if (what === "basis") {
      if (b?.structure === "basis_tracking")
        add(part.category, -(brokBasis.get(key) ?? 0));
      continue;
    }
    const side =
      b?.structure !== "roth_traditional"
        ? "balance"
        : part.taxType === "taxFree"
          ? "roth"
          : "traditional";
    add(`${part.category}:${side}`, -(indBalance.get(key) ?? 0));
  }
  return [...cents].filter(([, c]) => c !== 0);
});
const enter = vi.hoisted(() => (flow: string, what: "balance" | "basis") => {
  const run = seen.run;
  if (!run) return;
  seen.entries.set(flow, (seen.entries.get(flow) ?? 0) + 1);
  for (const [key, cents] of apartNow(run, what))
    seen.apart.push(`${flow} ${key}: ${cents}¢`);
});

vi.mock(
  "@/lib/pure/engine/projection-year-handlers/state",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/lib/pure/engine/projection-year-handlers/state")
      >();
    return {
      ...actual,
      buildProjectionState: (
        ...args: Parameters<typeof actual.buildProjectionState>
      ) => {
        const state = actual.buildProjectionState(...args);
        // eslint-disable-next-line no-restricted-syntax -- only the fields the sums read
        seen.run = { ctx: args[1], state } as unknown as Run;
        return state;
      },
    };
  },
);
vi.mock("@/lib/pure/engine/growth-application", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/pure/engine/growth-application")
    >();
  return {
    ...actual,
    applyGrowth: (...args: Parameters<typeof actual.applyGrowth>) => {
      enter("growth", "balance");
      return actual.applyGrowth(...args);
    },
  };
});
vi.mock("@/lib/pure/engine/balance-deduction", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/pure/engine/balance-deduction")
    >();
  return {
    ...actual,
    deductWithdrawals: (
      ...args: Parameters<typeof actual.deductWithdrawals>
    ) => {
      enter("deduction", "balance");
      return actual.deductWithdrawals(...args);
    },
  };
});
vi.mock("@/lib/pure/engine/brokerage-basis", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/pure/engine/brokerage-basis")>();
  return {
    ...actual,
    takeBasisOut: (...args: Parameters<typeof actual.takeBasisOut>) => {
      enter("basis out", "basis");
      return actual.takeBasisOut(...args);
    },
  };
});

import { calculateProjection } from "@/lib/pure/engine";
import type { ProjectionInput } from "@/lib/pure/engine/types";
import {
  arbitraryRetiredInput,
  arbitraryRmdInput,
  withAccountsAndSpecs,
  withRothConversions,
} from "../fixtures/engine-arbitraries";
import { couple } from "../fixtures/gap-year-couple";

/** Runs each input, returning which flows were entered and every slice or
 *  basis category apart from its parts on entry. */
function readsAtEntry(inputs: ProjectionInput[]) {
  seen.entries.clear();
  seen.apart.length = 0;
  try {
    for (const input of inputs) calculateProjection(input);
  } finally {
    seen.run = undefined;
  }
  return { entries: new Set(seen.entries.keys()), apart: seen.apart };
}

const sample = <T>(arbitrary: fc.Arbitrary<T>) =>
  fc.sample(arbitrary, { seed: 1, numRuns: 4 });

describe("the account parts land after the categories are read", () => {
  it("in a gap year's draw, its growth and the retirement years' draws", () => {
    const { entries, apart } = readsAtEntry([couple()]);
    expect(entries).toEqual(new Set(["growth", "deduction", "basis out"]));
    expect(apart).toEqual([]);
  });

  it("in the conversion's tax and an RMD's reinvested excess", () => {
    const { entries, apart } = readsAtEntry([
      ...sample(arbitraryRetiredInput()).map((input) =>
        withRothConversions(withAccountsAndSpecs(input)),
      ),
      ...sample(arbitraryRmdInput()).map(withAccountsAndSpecs),
    ]);
    expect(entries).toEqual(new Set(["growth", "deduction", "basis out"]));
    expect(apart).toEqual([]);
  });
});
