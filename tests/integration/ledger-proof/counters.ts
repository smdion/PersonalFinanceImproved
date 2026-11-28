/**
 * The ledger proof's counters: wrappers around the engine's own functions
 * (installed by `vi.mock` in ledger-proof.test.ts) that read what each flow
 * changed, in integer cents, at the seed and
 * at every settled point before `settle` writes the tax buckets.
 */
import {
  getAccountTypeConfig,
  getAllCategories,
  isPreTaxType,
  isRetirementMoney,
  isTaxFreeBucket,
} from "@/lib/config/account-types";
import {
  emptyTaxBucketMap,
  taxTypeOnSide,
} from "@/lib/config/tax-treatment-buckets";
import { categorySide } from "@/lib/pure/accounts/category-side";
import { hasRealAccount } from "@/lib/pure/accounts/account-part";

/* eslint-disable @typescript-eslint/no-explicit-any -- the wrappers take the engine's own arguments through, untyped, so a changed signature shows as an unexercised counter rather than a type error */

/** Amounts compare in integer cents: under half a cent is no hit. */
const CENT = 0.005;
const EPS = 1e-6;
const toCents = (x: number) => Math.round(x * 100) || 0;
const round2 = (x: number) => Math.round(x * 100) / 100;
const TAX_BUCKETS = Object.keys(emptyTaxBucketMap());
/** Settled points whose flow moves only the parts: the refresh there gives
 *  B its parts' sum, so D2 and D3 sampled before it measure the flow itself. */
const PARTS_ONLY = new Set([
  "accumulation.contributions",
  "accumulation.gapDraw",
  "accumulation.growth",
  "decumulation.growth",
  "decumulation.qcd",
  "decumulation.conversion",
  "decumulation.beforeReconcile",
]);

export type RunClass = "held" | "synthetic" | "noLedger" | "bo1";

/** A counter's tally: `n` where it was exercised, `hits` of a cent or more,
 *  `over` past its bound, and the first site of each. */
export type Counter = {
  n: number;
  hits: number;
  over: number;
  firstHit?: string;
  firstOver?: string;
};
export type Tally = {
  runs: Partial<Record<RunClass, number>>;
  counters: Record<string, Partial<Record<RunClass, Counter>>>;
};
const emptyTally = (): Tally => ({ runs: {}, counters: {} });

type Run = {
  cls: RunClass;
  ctx: any;
  state: any;
  inDraws: number;
  /** inside a real draw taken on copies of the run's own maps */
  onCopies: number;
  /** slice (`<category>:<side>`) → its parts' keys */
  sliceKeys: Map<string, string[]>;
  /** category → its parts' keys */
  categoryKeys: Map<string, string[]>;
};

const proof = {
  current: undefined as Run | undefined,
  /** Calls inside the withdrawal solver's tax estimate: trials on copies. */
  trial: 0,
  /** The class every run started now takes (the synthetic-category run). */
  forcedClass: undefined as RunClass | undefined,
  /** Writes $0.50 onto one part after a retirement year's Portfolio contributions. */
  damagePart: false,
  /** Sets one part to −$1 in the opening state, before the seed is sampled. */
  negativePart: false,
  scope: emptyTally(),
  total: emptyTally(),
};

function counterIn(t: Tally, name: string, cls: RunClass): Counter {
  return ((t.counters[name] ??= {})[cls] ??= { n: 0, hits: 0, over: 0 });
}

/** One observation: a hit is a cent or more; with a bound, `over` counts
 *  values past it. */
function observe(
  run: Run,
  name: string,
  value: number,
  where: string,
  bound?: number,
) {
  for (const t of [proof.scope, proof.total]) {
    const c = counterIn(t, name, run.cls);
    c.n++;
    if (Math.abs(toCents(value)) < 1) continue;
    c.hits++;
    c.firstHit ??= `${where}: ${value.toFixed(4)}`;
    if (bound != null && Math.abs(value) > bound + EPS) {
      c.over++;
      c.firstOver ??= `${where}: ${value.toFixed(4)} over ${bound.toFixed(3)}`;
    }
  }
}

const sideOf = (part: any) => categorySide(part.category, part.taxType);
function classify(ctx: any): RunClass {
  const parts: any[] = ctx.indAccounts ?? [];
  if (proof.forcedClass) return proof.forcedClass;
  if (parts.length === 0) return "noLedger";
  return parts.some((p) => hasRealAccount(p)) ? "held" : "synthetic";
}
function startRun(ctx: any): Run {
  const run: Run = {
    cls: classify(ctx),
    ctx,
    state: undefined,
    inDraws: 0,
    onCopies: 0,
    sliceKeys: new Map(),
    categoryKeys: new Map(),
  };
  for (const part of ctx.indAccounts ?? []) {
    const key = ctx.indKey(part);
    const slice = `${part.category}:${sideOf(part)}`;
    run.sliceKeys.set(slice, [...(run.sliceKeys.get(slice) ?? []), key]);
    run.categoryKeys.set(part.category, [
      ...(run.categoryKeys.get(part.category) ?? []),
      key,
    ]);
  }
  for (const t of [proof.scope, proof.total])
    t.runs[run.cls] = (t.runs[run.cls] ?? 0) + 1;
  return run;
}
const ledger = (run: Run) => run.cls !== "noLedger";
const own = (state: any) =>
  proof.current && proof.current.state === state ? proof.current : undefined;
const at = (run: Run, what: string) =>
  `y-index ${run.state.projectionByYear.length} ${what}`;

/** Each category side's money (B), its parts' sum (C), parts, holders and
 *  the parts' negative money. */
type SliceView = {
  B: number;
  C: number;
  parts: number;
  hold: number;
  negative: number;
  bucket: string;
};
function sliceView(run: Run): Map<string, SliceView> {
  const out = new Map<string, SliceView>();
  const partBalance: Map<string, number> = run.state.indBalance;
  for (const category of getAllCategories()) {
    const balance = run.state.accountBalance[category];
    const add = (side: string, B: number, bucket: string) => {
      const keys = run.sliceKeys.get(`${category}:${side}`) ?? [];
      const view: SliceView = {
        B,
        C: 0,
        parts: keys.length,
        hold: 0,
        negative: 0,
        bucket,
      };
      for (const key of keys) {
        const v = partBalance.get(key) ?? 0;
        view.C += v;
        if (Math.abs(v) >= CENT) view.hold++;
        if (v < 0) view.negative += -v;
      }
      out.set(`${category}:${side}`, view);
    };
    if (balance.structure === "roth_traditional") {
      add(
        "traditional",
        balance.traditional,
        taxTypeOnSide(category, "traditional"),
      );
      add("roth", balance.roth, taxTypeOnSide(category, "roth"));
    } else add("balance", balance.balance, taxTypeOnSide(category, undefined));
  }
  return out;
}

/** The sampler, at the seed and at every settled point before `settle`
 *  writes A (the tax buckets): A against buckets(B) (D1, the overwrite), B
 *  against its parts (D2), a category's basis against its parts' (D3). */
function sample(
  run: Run,
  point: string,
  taxBucketsOf: (b: any) => Record<string, number>,
) {
  const where = at(run, point);
  const A = run.state.balances;
  const view = taxBucketsOf(run.state.accountBalance);
  const slices = sliceView(run);
  const basis = A.afterTaxBasis - view.afterTaxBasis!;
  for (const bucket of TAX_BUCKETS) {
    const d = A[bucket] - view[bucket]!;
    if (point === "seed")
      observe(run, "seed.d1", d, `${where} ${bucket}`, CENT);
    else observe(run, "ra.overwrite", d, `${where} ${bucket}`, 0.02);
  }
  if (point === "seed") observe(run, "seed.d1", basis, `${where} basis`, CENT);
  else observe(run, "ra.overwrite", basis, `${where} basis`, 0.02);
  if (!ledger(run)) return;
  // No part is ever below $0: the opening state covers one saved there.
  for (const [key, v] of run.state.indBalance as Map<string, number>)
    observe(run, "neg.part", Math.min(0, v), `${where} ${key}`);
  if (PARTS_ONLY.has(point)) return;
  for (const [slice, e] of slices) {
    if (e.parts === 0) {
      observe(run, "d2.noPart", e.B, `${where} ${slice}`);
      continue;
    }
    observe(
      run,
      "d2",
      e.B - e.C,
      `${where} ${slice} (B ${e.B.toFixed(2)}, parts ${e.C.toFixed(2)})`,
    );
  }
  for (const category of getAllCategories()) {
    const balance = run.state.accountBalance[category];
    if (balance.structure !== "basis_tracking") continue;
    const keys = run.categoryKeys.get(category) ?? [];
    if (keys.length === 0) {
      observe(run, "d3.noPart", balance.basis, `${where} ${category}`);
      continue;
    }
    const parts = keys.reduce(
      (s, k) => s + (run.state.brokBasis.get(k) ?? 0),
      0,
    );
    observe(
      run,
      "d3",
      balance.basis - parts,
      `${where} ${category} (basis ${balance.basis.toFixed(2)}, parts ${parts.toFixed(2)})`,
    );
  }
}

// ---- the wrappers: each takes the engine module and returns its stand-ins ----

/** `buildProjectionState`: a run starts, and its opening state is sampled
 *  as the seed. */
export function stateModule(
  m: any,
  taxBucketsOf: (b: any) => Record<string, number>,
) {
  return {
    ...m,
    buildProjectionState: (input: any, ctx: any) => {
      const run = startRun(ctx);
      proof.current = run;
      const state = m.buildProjectionState(input, ctx);
      run.state = state;
      const [first] = state.indBalance.keys();
      if (proof.negativePart && first) state.indBalance.set(first, -1);
      sample(run, "seed", taxBucketsOf);
      return state;
    },
  };
}

/** `settle`: sampled before its write. */
export function settleModule(m: any) {
  return {
    ...m,
    settle: (ctx: any, state: any, point: string) => {
      const run = own(state);
      if (run) sample(run, point, m.taxBucketsOf);
      m.settle(ctx, state, point);
    },
  };
}

/** `decumulationPortfolioContributions` (reported only, no flow writes
 *  there): the damage case writes onto one part after it, before its
 *  settled point. */
export function portfolioContributionsModule(m: any) {
  return {
    ...m,
    decumulationPortfolioContributions: (
      ctx: any,
      state: any,
      ...rest: any[]
    ) => {
      const out = m.decumulationPortfolioContributions(ctx, state, ...rest);
      const run = own(state);
      if (run && proof.damagePart) {
        const first = [...sliceView(run)].find(([, e]) => e.parts > 0)?.[0];
        const key = first && run.sliceKeys.get(first)![0]!;
        if (key)
          run.state.indBalance.set(
            key,
            round2((run.state.indBalance.get(key) ?? 0) + 0.5),
          );
      }
      return out;
    },
  };
}

const ownMap = (map: unknown) =>
  proof.current && map === proof.current.state?.indBalance
    ? proof.current
    : undefined;

/** The draws on copies of the run's maps (each counted as a trial). */
export function brokerageBasisModule(m: any) {
  return {
    ...m,
    followDrawsOnCopies: (
      parts: any[],
      partKey: any,
      partBalance: Map<string, number>,
      basis: Map<string, number>,
      mutate: (drawn: Map<string, number>) => unknown,
    ) => {
      const run = ownMap(partBalance);
      if (run) run.onCopies++;
      try {
        return m.followDrawsOnCopies(
          parts,
          partKey,
          partBalance,
          basis,
          mutate,
        );
      } finally {
        if (run) run.onCopies--;
      }
    },
  };
}

/** The year's draws: `distributeWithdrawals` counts only inside them (or a
 *  gap year's take, on copies of the run's own maps). */
export function yearDrawsModule(m: any) {
  return {
    ...m,
    distributeYearDraws: (ctx: any, state: any, ...rest: any[]) => {
      const run = own(state);
      if (!run) return m.distributeYearDraws(ctx, state, ...rest);
      run.inDraws++;
      try {
        return m.distributeYearDraws(ctx, state, ...rest);
      } finally {
        run.inDraws--;
      }
    },
  };
}

/** The solver's tax estimate draws on copies: never a real debit. */
export function withdrawalSolverModule(m: any) {
  return {
    ...m,
    estimateWithdrawalTaxCost: (...args: any[]) => {
      proof.trial++;
      try {
        return m.estimateWithdrawalTaxCost(...args);
      } finally {
        proof.trial--;
      }
    },
  };
}

/** Each slot's draw, per side, against what its Retirement parts took. */
export function withdrawalsModule(m: any) {
  return {
    ...m,
    distributeWithdrawals: (
      slots: any[],
      parts: any[],
      partKey: any,
      partBalance: Map<string, number>,
      eligibility: any,
      pins: any,
    ) => {
      const run = proof.current;
      const real =
        !!run?.state &&
        proof.trial === 0 &&
        (run.inDraws > 0 ||
          run.onCopies > 0 ||
          partBalance === run.state.indBalance);
      const out = m.distributeWithdrawals(
        slots,
        parts,
        partKey,
        partBalance,
        eligibility,
        pins,
      );
      if (!real) return out;
      const drawn: Map<string, number> = out.decumulationIndWithdrawal;
      const where = at(run, run.inDraws > 0 ? "draws" : "gap draw");
      const placedOn = (list: any[]) =>
        list.reduce((s, p) => s + (drawn.get(partKey(p)) ?? 0), 0);
      for (const slot of slots) {
        if (slot.withdrawal <= 0) continue;
        const inCategory = parts.filter(
          (p) =>
            p.category === slot.category && isRetirementMoney(p.parentCategory),
        );
        const split =
          getAccountTypeConfig(slot.category).balanceStructure ===
            "roth_traditional" &&
          (slot.traditionalWithdrawal > 0 || slot.rothWithdrawal > 0);
        if (!split) {
          observe(
            run,
            "unplaced.draw",
            Math.max(0, slot.withdrawal - placedOn(inCategory)),
            `${where} ${slot.category}`,
          );
          continue;
        }
        const traditional = inCategory.filter((p) => isPreTaxType(p.taxType));
        const roth = inCategory.filter((p) => isTaxFreeBucket(p.taxType));
        observe(
          run,
          "unplaced.draw",
          Math.max(0, slot.traditionalWithdrawal - placedOn(traditional)),
          `${where} ${slot.category} Traditional`,
        );
        observe(
          run,
          "unplaced.draw",
          Math.max(0, slot.rothWithdrawal - placedOn(roth)),
          `${where} ${slot.category} Roth`,
        );
        observe(
          run,
          "unplaced.draw",
          Math.max(
            0,
            slot.withdrawal - slot.traditionalWithdrawal - slot.rothWithdrawal,
          ),
          `${where} ${slot.category} outside its sides`,
        );
      }
      return out;
    },
  };
}

/** The conversion's debit: the remainder past the capped shares. A debit or
 *  tax from parts holding nothing throws (`debitByBalance`). */
export function conversionModule(m: any) {
  const retirementParts = (parts: any, category: string) =>
    parts.accounts.filter(
      (p: any) =>
        p.category === category && isRetirementMoney(p.parentCategory),
    );
  return {
    ...m,
    debitConvertedParts: (parts: any, categoryShare: Map<string, number>) => {
      const run = ownMap(parts.balances);
      if (!run) return m.debitConvertedParts(parts, categoryShare);
      const where = at(run, "conversion");
      for (const [category, amount] of categoryShare) {
        if (amount <= 0) continue;
        const list = retirementParts(parts, category).filter((p: any) =>
          isPreTaxType(p.taxType),
        );
        const held = list.map((p: any) =>
          Math.max(0, parts.balances.get(parts.keyOf(p)) ?? 0),
        );
        const total = held.reduce((s: number, b: number) => s + b, 0);
        if (total > 0) {
          const capped = held.reduce(
            (s: number, b: number) =>
              s + Math.min(round2(amount * (b / total)), b),
            0,
          );
          const remainder = round2(amount - capped);
          observe(
            run,
            "conv.mopUp",
            remainder > CENT * list.length ? remainder : 0,
            `${where} ${category} (${list.length} parts)`,
          );
        }
      }
      return m.debitConvertedParts(parts, categoryShare);
    },
  };
}

// ---- the test's handle ----

/** Counters whose hits are stops in every judged class. */
export const STOPS = [
  "seed.d1",
  "d2",
  "d3",
  "d2.noPart",
  "d3.noPart",
  "unplaced.draw",
  "conv.mopUp",
  "neg.part",
] as const;
/** Counters judged by their bound: `over` is the stop. */
export const BOUNDED = ["ra.overwrite"] as const;
/** The synthetic-category run is judged on its ledger only (D2, D3). */
const BO1_JUDGED = new Set<string>(["d2", "d3", "d2.noPart", "d3.noPart"]);

/** Runs `fn` with fresh scope counters and returns them. */
export async function measure(
  fn: () => unknown,
  options: {
    forcedClass?: RunClass;
    damagePart?: boolean;
    negativePart?: boolean;
  } = {},
): Promise<Tally> {
  proof.scope = emptyTally();
  proof.forcedClass = options.forcedClass;
  proof.damagePart = options.damagePart ?? false;
  proof.negativePart = options.negativePart ?? false;
  try {
    await fn();
  } finally {
    proof.forcedClass = undefined;
    proof.damagePart = false;
    proof.negativePart = false;
    proof.current = undefined;
  }
  return proof.scope;
}

/** Every stop that fired, with its first site: `[]` passes. */
export function failures(t: Tally): string[] {
  const out: string[] = [];
  if (t.runs.noLedger)
    out.push(`noLedger: ${t.runs.noLedger} runs with no parts`);
  for (const [name, byClass] of Object.entries(t.counters))
    for (const [cls, c] of Object.entries(byClass) as [RunClass, Counter][]) {
      if (cls === "bo1" && !BO1_JUDGED.has(name)) continue;
      if ((STOPS as readonly string[]).includes(name) && c.hits > 0)
        out.push(`${name} [${cls}] ${c.hits} hits, first ${c.firstHit}`);
      if ((BOUNDED as readonly string[]).includes(name) && c.over > 0)
        out.push(`${name} [${cls}] ${c.over} over, first ${c.firstOver}`);
    }
  return out;
}

/** The whole file's counters, every scope added. */
export const totals = () => proof.total;
