/**
 * A lump sum the forms save keeps the lump-sum-targets tag's id keys (MG1):
 * re-saving a converted set with a new lump sum, from Changes by year or
 * the Brokerage page, and then replaying the tag writes nothing. A name
 * that picks more than one part saves a null id. Where the projection's name
 * is a stored column, the ids match what the tag writes for it.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LumpSumFields } from "@/components/retirement-projection/overrides/override-field-parts";
import { LumpSumForm } from "@/components/retirement-projection/lump-sum-form";
import { accountOption } from "@/components/retirement-projection/lump-sum-target";
import type { LumpSumEvent } from "@/components/retirement-projection/types";
import type { IndividualAccountYearBalance } from "@/lib/pure/accounts/account-balances.types";
import { LUMP_SUM_TARGETS_CONVERTER } from "@/lib/db/migrate/v0111-lump-sum-targets";
import {
  PEOPLE,
  PERFORMANCE_ACCOUNTS,
  PORTFOLIO_ACCOUNTS,
  SETS,
  SNAPSHOTS,
} from "../../db/lump-sum-targets-cases";

/** The projection's rows as the payload builds them for the fixture's
 *  accounts: one owner's 401k, an IRA held in two owners' parts (one row per
 *  part, each with the account's id), and a snapshot row linked to no
 *  account (no id). */
const part = (
  name: string,
  ownerName: string,
  ownerPersonId: number,
  id?: number,
) => ({
  name,
  category: "401k",
  taxType: "preTax",
  ownerName,
  ownerPersonId,
  ...(id !== undefined ? { performanceAccountId: id } : {}),
});
const rows = [
  part("Invented 401k", "Invented Earner", 61, 81),
  part("Invented Joint IRA", "Invented Earner", 61, 82),
  part("Invented Joint IRA", "Invented Spouse", 62, 82),
  part("Invented Loose", "Invented Earner", 61),
] as IndividualAccountYearBalance[];

/** What the tag writes when replayed over one saved set. */
function replay(id: number, type: string, overrides: unknown[]) {
  return LUMP_SUM_TARGETS_CONVERTER.convert({
    projection_overrides: [{ id, override_type: type, overrides }],
    people: PEOPLE.map((p) => ({ ...p })),
    performance_accounts: PERFORMANCE_ACCOUNTS.map((a) => ({ ...a })),
    portfolio_accounts: PORTFOLIO_ACCOUNTS.map((r) => ({ ...r })),
    portfolio_snapshots: SNAPSHOTS.map((s) => ({ ...s })),
  }).updates;
}

const setOf = (type: string) => SETS.find((c) => c.type === type)!;

function addLumpSum(amount: string, option?: string) {
  if (option)
    fireEvent.change(screen.getByLabelText("Account"), {
      target: { value: option },
    });
  fireEvent.change(screen.getByPlaceholderText("$50,000"), {
    target: { value: amount },
  });
  fireEvent.click(screen.getByText("Add"));
}

describe("a re-saved lump sum set, then the lump-sum-targets tag replayed", () => {
  it("Changes by year: the new lump sum carries the ids the tag would write, and the replay writes nothing", () => {
    const setAccumOverrides = vi.fn();
    const state = {
      individualAccountNames: rows.map((r) => accountOption(r)),
      setAccumOverrides,
      setDecumOverrides: vi.fn(),
      result: { projectionByYear: [] },
    };
    render(
      <LumpSumFields
        isPostRetirement={false}
        resetWizard={vi.fn()}
        selectedYear="2040"
        state={state as never}
        year={2040}
      />,
    );
    addLumpSum("1000");
    addLumpSum("2000", "Invented Joint IRA::Invented Spouse");
    addLumpSum("3000", "Invented Loose::Invented Earner");
    const converted = setOf("accumulation");
    let saved = [...converted.after];
    for (const [update] of setAccumOverrides.mock.calls) saved = update(saved);

    const added = saved
      .filter((o) => (o as { year: number }).year === 2040)
      .flatMap((o) => (o as { lumpSums: object[] }).lumpSums);
    expect(added).toEqual([
      expect.objectContaining({
        targetAccountName: "Invented 401k",
        targetOwnerName: "Invented Earner",
        targetPerformanceAccountId: 81,
        targetOwnerPersonId: 61,
      }),
      expect.objectContaining({
        targetAccountName: "Invented Joint IRA",
        targetOwnerName: "Invented Spouse",
        targetPerformanceAccountId: 82,
        targetOwnerPersonId: 62,
      }),
      expect.objectContaining({
        targetAccountName: "Invented Loose",
        targetPerformanceAccountId: null,
      }),
    ]);
    expect(added[2]).not.toHaveProperty("targetOwnerPersonId");
    // The same names with no keys: the tag writes these very ids.
    const unkeyed = added.map((ls) => {
      const rest: Record<string, unknown> = { ...ls };
      delete rest["targetPerformanceAccountId"];
      delete rest["targetOwnerPersonId"];
      return rest;
    });
    const written = replay(converted.id, "accumulation", [
      { year: 2040, lumpSums: unkeyed },
    ]);
    expect(written[0]?.set["overrides"]).toEqual([
      { year: 2040, lumpSums: added },
    ]);

    expect(replay(converted.id, "accumulation", saved)).toEqual([]);
  });

  it("the Brokerage page: new planned events beside the converted ones, a name two parts share saving a null id, and the replay writes nothing", () => {
    const onAdd = vi.fn<(ls: LumpSumEvent) => void>();
    render(
      <LumpSumForm
        accounts={rows.map((r) => accountOption(r, false))}
        onAdd={onAdd}
        allowWithdrawals
      />,
    );
    addLumpSum("750");
    addLumpSum("250", "Invented Joint IRA::");
    const events = onAdd.mock.calls.map(([e]) => e);
    expect(events[0]).toMatchObject({
      targetAccountName: "Invented 401k",
      targetOwnerName: "",
      targetPerformanceAccountId: 81,
      targetOwnerPersonId: 61,
    });
    // The picker names no owner, so this name picks both parts.
    expect(events[1]).toMatchObject({
      targetAccountName: "Invented Joint IRA",
      targetPerformanceAccountId: null,
    });
    expect(events[1]).not.toHaveProperty("targetOwnerPersonId");
    const converted = setOf("brokerage");
    expect(
      replay(converted.id, "brokerage", [...converted.after, ...events]),
    ).toEqual([]);
  });
});
