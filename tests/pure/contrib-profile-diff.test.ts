import { describe, it, expect } from "vitest";
import {
  diffContribProfileSwap,
  type DiffAccount,
} from "@/lib/pure/contrib-profile-diff";

const account = (overrides: Partial<DiffAccount> = {}): DiffAccount => ({
  id: 1,
  accountName: "Alex 401k",
  live: { contributionValue: "0", contributionMethod: "percent_of_salary" },
  ...overrides,
});

describe("diffContribProfileSwap", () => {
  it("produces no lines when neither profile touches the account", () => {
    const lines = diffContribProfileSwap({}, {}, [account()]);
    expect(lines).toEqual([]);
  });

  it("produces no lines when both profiles set the same value", () => {
    const outgoing = { "1": { contributionValue: "14" } };
    const incoming = { "1": { contributionValue: "14" } };
    expect(diffContribProfileSwap(outgoing, incoming, [account()])).toEqual([]);
  });

  it("a displayNameCustom-only difference produces no line (cosmetic)", () => {
    const outgoing = {
      "1": { contributionValue: "14", displayNameCustom: "My 401k" },
    };
    const incoming = { "1": { contributionValue: "14" } };
    expect(diffContribProfileSwap(outgoing, incoming, [account()])).toEqual([]);
  });

  it("falls back to the live value when incoming doesn't touch the account", () => {
    const outgoing = {
      "1": { contributionValue: "14", contributionMethod: "percent_of_salary" },
    };
    const lines = diffContribProfileSwap(outgoing, {}, [
      account({
        live: {
          contributionValue: "0",
          contributionMethod: "percent_of_salary",
        },
      }),
    ]);
    expect(lines).toEqual([
      "Alex 401k: 14% → using account's own value (currently 0%)",
    ]);
  });

  it("shows a direct value change when both profiles touch the account", () => {
    const outgoing = {
      "1": { contributionValue: "14", contributionMethod: "percent_of_salary" },
    };
    const incoming = {
      "1": { contributionValue: "20", contributionMethod: "percent_of_salary" },
    };
    const lines = diffContribProfileSwap(outgoing, incoming, [account()]);
    expect(lines).toEqual(["Alex 401k: 14% → 20%"]);
  });

  it("isActive: false gets the 'excluded' phrasing, distinct from a rate change", () => {
    const outgoing = { "1": { isActive: false } };
    const lines = diffContribProfileSwap(outgoing, {}, [
      account({ live: { contributionValue: "10", isActive: true } }),
    ]);
    expect(lines).toEqual([
      "Alex 401k: excluded → using account's own value (currently 10)",
    ]);
  });

  it("multiple affected accounts produce multiple lines in stable order", () => {
    const outgoing = {
      "1": { contributionValue: "14", contributionMethod: "percent_of_salary" },
      "2": { contributionValue: "500" },
    };
    const lines = diffContribProfileSwap(outgoing, {}, [
      account({
        id: 1,
        accountName: "Alex 401k",
        live: {
          contributionValue: "0",
          contributionMethod: "percent_of_salary",
        },
      }),
      account({
        id: 2,
        accountName: "Alex IRA",
        live: { contributionValue: "0" },
      }),
    ]);
    expect(lines).toEqual([
      "Alex 401k: 14% → using account's own value (currently 0%)",
      "Alex IRA: 500 → using account's own value (currently 0)",
    ]);
  });

  it("does not fire for an account neither profile's map even mentions", () => {
    const lines = diffContribProfileSwap(
      { "2": { contributionValue: "500" } },
      {},
      [account({ id: 1 })],
    );
    expect(lines).toEqual([]);
  });
});

describe("diffContribProfileSwap — taken from bonus checks", () => {
  it("a fromBonus difference is a line; absent and false are the same", () => {
    const value = {
      contributionValue: "8",
      contributionMethod: "percent_of_salary",
    };
    expect(
      diffContribProfileSwap(
        { "1": { ...value, fromBonus: true } },
        { "1": value },
        [account()],
      ),
    ).toEqual(["Alex 401k: 8% + bonus checks → 8%"]);
    expect(
      diffContribProfileSwap(
        { "1": { ...value, fromBonus: false } },
        { "1": value },
        [account()],
      ),
    ).toEqual([]);
  });
});

describe("diffContribProfileSwap — Roth IRA route", () => {
  it("a route difference is a line; absent and direct are the same", () => {
    const value = {
      contributionValue: "625",
      contributionMethod: "fixed_monthly",
    };
    expect(
      diffContribProfileSwap(
        { "1": { ...value, rothRoute: "backdoor" } },
        { "1": value },
        [account({ accountName: "Alex Roth IRA" })],
      ),
    ).toEqual(["Alex Roth IRA: 625 via backdoor → 625"]);
    expect(
      diffContribProfileSwap(
        { "1": { ...value, rothRoute: "direct" } },
        { "1": value },
        [account()],
      ),
    ).toEqual([]);
  });
});
