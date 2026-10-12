/**
 * Suggest which sub-account each unlinked SimpleFIN account is. Pure;
 * suggestions only — the household confirms each one.
 *
 * A candidate must be at the same institution and of the same account
 * kind (from the SimpleFIN account's name); the tax treatment must agree
 * when the name states one. Among look-alikes (e.g. two people's Roth
 * IRAs) the balance closest to the sub-account's latest snapshot amount
 * wins, and each sub-account is suggested at most once.
 */
import { recogniseAccountKind } from "@/lib/config/simplefin-account-kinds";
import type { AccountCategory } from "@/lib/config/account-types.types";
import type { PortfolioTaxType } from "@/lib/config/enum-values";

export type UnlinkedSimplefinAccount = {
  id: number;
  orgName: string;
  accountName: string;
  balance: number;
};

export type SubAccountCandidate = {
  performanceAccountId: number;
  institution: string;
  accountType: AccountCategory;
  ownerPersonId: number | null;
  /** Null for a whole-account candidate. */
  taxType: PortfolioTaxType | null;
  subType: string | null;
  /** Latest snapshot amount. */
  amount: number;
};

export type LinkSuggestion = {
  simplefinAccountId: number;
  candidate: SubAccountCandidate;
};

const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(" ")
      .filter((w) => w.length > 2),
  );

/** Institutions match when one name's words include the other's (e.g. "Vanguard" ⊂ "Vanguard"; "Fidelity" ⊂ "Fidelity Investments"). */
export function sameInstitution(a: string, b: string): boolean {
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 || wb.size === 0) return false;
  const [small, big] = wa.size <= wb.size ? [wa, wb] : [wb, wa];
  return [...small].every((w) => big.has(w));
}

/** The whole tracked account as a candidate: all its sub-accounts together. */
function wholeAccounts(
  candidates: readonly SubAccountCandidate[],
): SubAccountCandidate[] {
  const byAccount = new Map<number, SubAccountCandidate>();
  for (const c of candidates) {
    const w = byAccount.get(c.performanceAccountId);
    if (w) w.amount += c.amount;
    else
      byAccount.set(c.performanceAccountId, {
        ...c,
        ownerPersonId: null,
        taxType: null,
        subType: null,
      });
  }
  return [...byAccount.values()];
}

export function suggestLinks(
  accounts: readonly UnlinkedSimplefinAccount[],
  candidates: readonly SubAccountCandidate[],
): LinkSuggestion[] {
  const whole = wholeAccounts(candidates);
  // Every acceptable (account, candidate) pair with its relative balance gap.
  const options = new Map<number, { c: SubAccountCandidate; gap: number }[]>();
  for (const a of accounts) {
    const kind = recogniseAccountKind(a.accountName);
    if (!kind) continue;
    // A name that states the tax treatment is one sub-account; one that
    // doesn't (e.g. a workplace plan holding Roth + pre-tax + match) is
    // the whole tracked account.
    const pool = kind.taxType ? candidates : whole;
    const list = [];
    for (const c of pool) {
      if (!sameInstitution(a.orgName, c.institution)) continue;
      if (c.accountType !== kind.accountType) continue;
      if (kind.taxType && c.taxType !== kind.taxType) continue;
      if (kind.subType && c.subType !== kind.subType) continue;
      const scale = Math.max(Math.abs(c.amount), Math.abs(a.balance), 1);
      list.push({ c, gap: Math.abs(a.balance - c.amount) / scale });
    }
    if (list.length)
      options.set(
        a.id,
        list.sort((x, y) => x.gap - y.gap),
      );
  }
  // Assignment with the smallest total gap, each candidate used once
  // (exhaustive search — households have a handful of look-alikes; falls
  // back to closest-first beyond that).
  const ids = [...options.keys()];
  if (ids.length > 10) return greedy(ids, options);
  const best = {
    total: Infinity,
    picks: new Map<number, SubAccountCandidate>(),
  };
  const picks = new Map<number, SubAccountCandidate>();
  const used = new Set<SubAccountCandidate>();
  const search = (i: number, total: number) => {
    if (total >= best.total && picks.size >= best.picks.size) return;
    if (i === ids.length) {
      if (
        picks.size > best.picks.size ||
        (picks.size === best.picks.size && total < best.total)
      ) {
        best.total = total;
        best.picks = new Map(picks);
      }
      return;
    }
    const id = ids[i]!;
    for (const o of options.get(id)!) {
      if (used.has(o.c)) continue;
      used.add(o.c);
      picks.set(id, o.c);
      search(i + 1, total + o.gap);
      picks.delete(id);
      used.delete(o.c);
    }
    search(i + 1, total + 1); // leave this account without a suggestion
  };
  search(0, 0);
  return [...best.picks.entries()].map(([simplefinAccountId, candidate]) => ({
    simplefinAccountId,
    candidate,
  }));
}

function greedy(
  ids: number[],
  options: Map<number, { c: SubAccountCandidate; gap: number }[]>,
): LinkSuggestion[] {
  const pairs = ids.flatMap((id) =>
    options.get(id)!.map((o) => ({ id, ...o })),
  );
  pairs.sort((x, y) => x.gap - y.gap);
  const usedIds = new Set<number>();
  const usedC = new Set<SubAccountCandidate>();
  const out: LinkSuggestion[] = [];
  for (const p of pairs) {
    if (usedIds.has(p.id) || usedC.has(p.c)) continue;
    usedIds.add(p.id);
    usedC.add(p.c);
    out.push({ simplefinAccountId: p.id, candidate: p.c });
  }
  return out;
}
