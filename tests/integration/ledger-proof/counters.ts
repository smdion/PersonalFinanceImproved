/**
 * The ledger proof's counters: wrappers around the engine's own functions
 * (installed by `vi.mock` in ledger-proof.test.ts) that read what each flow
 * and each year-end correction changed, in integer cents, at the seed and
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
  /** Writes $0.50 onto one part after the year's growth. */
  damagePart: false,
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
  // At growth, B grows by its parts' rounded products: one rounding per part
  // holding money in the bucket (with no parts, per category side holding).
  const holding: Record<string, number> = {};
  for (const e of slices.values())
    holding[e.bucket] =
      (holding[e.bucket] ?? 0) +
      (ledger(run) ? e.hold : Math.abs(e.B) >= CENT ? 1 : 0);
  const growth = point.endsWith(".growth");
  const basis = A.afterTaxBasis - view.afterTaxBasis!;
  for (const bucket of TAX_BUCKETS) {
    const d = A[bucket] - view[bucket]!;
    if (point === "seed")
      observe(run, "seed.d1", d, `${where} ${bucket}`, CENT);
    else if (growth)
      observe(
        run,
        "ra.overwrite",
        d,
        `${where} ${bucket} (${holding[bucket] ?? 0} holding)`,
        CENT * ((holding[bucket] ?? 0) + 1),
      );
    else observe(run, "ra.overwrite", d, `${where} ${bucket}`, 0.02);
  }
  if (point === "seed") observe(run, "seed.d1", basis, `${where} basis`, CENT);
  else observe(run, "ra.overwrite", basis, `${where} basis`, 0.02);
  if (!ledger(run)) return;
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
      sample(run, "seed", taxBucketsOf);
      return state;
    },
  };
}

/** `settle`: sampled before its write. */
export function settleModule(m: any) {
  return {
    ...m,
    settle: (state: any, point: string) => {
      const run = own(state);
      if (run) sample(run, point, m.taxBucketsOf);
      m.settle(state, point);
    },
  };
}

/** `growYear`: B's growth (its parts' rounded products) against its own
 *  rounded product, the parts' floor raises, and D2 unchanged across it. */
export function yearGrowthModule(m: any) {
  return {
    ...m,
    growYear: (ctx: any, state: any, rate: number, clampNegative: boolean) => {
      const run = own(state);
      if (!run || !ledger(run))
        return m.growYear(ctx, state, rate, clampNegative);
      const pre = sliceView(run);
      const out = m.growYear(ctx, state, rate, clampNegative);
      const first = [...pre].find(([, e]) => e.parts > 0)?.[0];
      if (proof.damagePart && first) {
        const key = run.sliceKeys.get(first)![0]!;
        state.indBalance.set(
          key,
          round2((state.indBalance.get(key) ?? 0) + 0.5),
        );
      }
      const post = sliceView(run);
      const point = clampNegative
        ? "decumulation.growth"
        : "accumulation.growth";
      for (const [slice, b] of pre) {
        if (b.parts === 0) continue;
        const a = post.get(slice)!;
        const raise = clampNegative ? b.negative : 0;
        const ownGrowth = round2(b.B * (1 + rate)) - b.B;
        const where = `${at(run, point)} ${slice}`;
        observe(
          run,
          "rb.growth",
          a.B - b.B - ownGrowth - raise,
          `${where} (B ${b.B.toFixed(2)}, ${b.hold} holding)`,
          CENT * (b.hold + 1),
        );
        if (raise > 0)
          observe(
            run,
            "rb.floor",
            raise,
            `${where} parts' raise`,
            0.01 * b.parts,
          );
        observe(
          run,
          "rb.identity",
          toCents(a.B - a.C) / 100 - toCents(b.B - b.C) / 100,
          where,
        );
      }
      return out;
    },
  };
}

/** `floorPartsAndSlices`: B's move is the parts' raises less B's own. */
export function categorySlicesModule(m: any) {
  return {
    ...m,
    floorPartsAndSlices: (
      ctx: any,
      state: any,
      ownRaises: Map<string, number>,
    ) => {
      const run = own(state);
      if (!run || !ledger(run))
        return m.floorPartsAndSlices(ctx, state, ownRaises);
      const pre = sliceView(run);
      const out = m.floorPartsAndSlices(ctx, state, ownRaises);
      const post = sliceView(run);
      for (const [slice, b] of pre) {
        if (b.parts === 0) continue;
        const a = post.get(slice)!;
        const [category, side] = slice.split(":");
        const ownRaise = ownRaises.get(m.sliceKey(category, side)) ?? 0;
        const where = `${at(run, "floor")} ${slice}`;
        observe(run, "rb.floor", a.B - b.B, where, 0.01 * b.parts);
        observe(
          run,
          "rb.identity",
          toCents(a.B - a.C) / 100 - toCents(b.B - ownRaise - b.C) / 100,
          where,
        );
      }
      return out;
    },
  };
}

const snapshot = (map: Map<string, number>, keys: Iterable<string>) =>
  new Map([...keys].map((k) => [k, map.get(k) ?? 0]));
const ownMap = (map: unknown) =>
  proof.current && map === proof.current.state?.indBalance
    ? proof.current
    : undefined;

/** The yearly reconcile: what it wrote on the parts' balances. */
export function reconcileModule(m: any) {
  return {
    ...m,
    reconcileIndividualToAggregate: (
      parts: any[],
      partKey: any,
      partBalance: Map<string, number>,
      accountBalance: any,
    ) => {
      const run = ownMap(partBalance);
      if (!run)
        return m.reconcileIndividualToAggregate(
          parts,
          partKey,
          partBalance,
          accountBalance,
        );
      const before = snapshot(partBalance, parts.map(partKey));
      const out = m.reconcileIndividualToAggregate(
        parts,
        partKey,
        partBalance,
        accountBalance,
      );
      let total = 0;
      let largest = "";
      for (const [k, v] of before) {
        const d = (partBalance.get(k) ?? 0) - v;
        total += Math.abs(d);
        if (Math.abs(d) >= CENT && !largest) largest = `${k} ${d.toFixed(2)}`;
      }
      observe(run, "reconcile.write", total, at(run, `reconcile ${largest}`));
      return out;
    },
  };
}

/** The surplus handoff, and the basis sync's keep-A branch and writes. */
export function brokerageBasisModule(m: any) {
  return {
    ...m,
    followDrawsSoldOnCopies: (
      parts: any[],
      partKey: any,
      partBalance: Map<string, number>,
      basis: Map<string, number>,
      mutate: (drawn: Map<string, number>) => unknown,
    ) => {
      const run = ownMap(partBalance);
      if (run) run.onCopies++;
      try {
        return m.followDrawsSoldOnCopies(
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
    followReconciliation: (
      parts: any[],
      partKey: any,
      partBalance: Map<string, number>,
      basis: Map<string, number>,
      aggregateBasis: number,
      mutate: () => unknown,
    ) => {
      const run = ownMap(partBalance);
      const call = () =>
        m.followReconciliation(
          parts,
          partKey,
          partBalance,
          basis,
          aggregateBasis,
          mutate,
        );
      if (!run) return call();
      const before = new Map(basis);
      const out = call();
      let handoff = 0;
      for (const [k, v] of basis)
        handoff += Math.max(0, v - (before.get(k) ?? 0));
      observe(run, "handoff", handoff, at(run, "handoff"));
      return out;
    },
    syncAggregateBasis: (
      parts: any[],
      partKey: any,
      partBalance: Map<string, number>,
      basis: Map<string, number>,
      balances: any,
      accountBalance: any,
      diagnostics: string[],
    ) => {
      const run = ownMap(partBalance);
      const call = () =>
        m.syncAggregateBasis(
          parts,
          partKey,
          partBalance,
          basis,
          balances,
          accountBalance,
          diagnostics,
        );
      const tracked = parts.filter(
        (p) =>
          getAccountTypeConfig(p.category).balanceStructure ===
          "basis_tracking",
      );
      if (!run || tracked.length === 0) return call();
      const A = run.state.balances;
      const B = run.state.accountBalance;
      const held = tracked.reduce(
        (s, p) => s + Math.max(0, partBalance.get(partKey(p)) ?? 0),
        0,
      );
      const keepA = Math.abs(held - A.afterTax) > 1;
      observe(
        run,
        "keepA",
        keepA ? 1 : 0,
        at(run, `sync: parts hold ${held.toFixed(2)} of ${A.afterTax}`),
      );
      const basisA = A.afterTaxBasis;
      const basisB = new Map(
        getAllCategories().map((c) => [c, B[c].basis ?? 0]),
      );
      const out = call();
      if (!keepA) {
        observe(
          run,
          "sync.writeA",
          A.afterTaxBasis - basisA,
          at(run, "sync afterTaxBasis"),
        );
        for (const [c, v] of basisB)
          if (B[c].structure === "basis_tracking")
            observe(run, "sync.writeB", B[c].basis - v, at(run, `sync ${c}`));
      }
      return out;
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

/** The conversion's debit and its tax, each against what the parts gave
 *  (and the remainder past the capped shares, and a tax no part paid). */
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
      const traditional = new Map<string, any[]>();
      for (const [category, amount] of categoryShare) {
        if (amount <= 0) continue;
        const list = retirementParts(parts, category).filter((p: any) =>
          isPreTaxType(p.taxType),
        );
        traditional.set(category, list);
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
      const keys = [...traditional.values()].flat().map((p) => parts.keyOf(p));
      const before = snapshot(parts.balances, keys);
      const out = m.debitConvertedParts(parts, categoryShare);
      for (const [category, list] of traditional) {
        const placed = list.reduce(
          (s: number, p: any) =>
            s +
            (before.get(parts.keyOf(p))! -
              (parts.balances.get(parts.keyOf(p)) ?? 0)),
          0,
        );
        observe(
          run,
          "unplaced.conv",
          Math.max(0, categoryShare.get(category)! - placed),
          `${where} ${category}`,
        );
      }
      return out;
    },
    payConversionTaxFromParts: (
      parts: any,
      category: string,
      tax: number,
      totals: any,
    ) => {
      const run = ownMap(parts.balances);
      if (!run)
        return m.payConversionTaxFromParts(parts, category, tax, totals);
      const list = retirementParts(parts, category);
      const before = snapshot(
        parts.balances,
        list.map((p: any) => parts.keyOf(p)),
      );
      const out = m.payConversionTaxFromParts(parts, category, tax, totals);
      const placed = [...before].reduce(
        (s, [k, v]) => s + v - (parts.balances.get(k) ?? 0),
        0,
      );
      const where = `${at(run, "conversion tax")} ${category} (tax ${tax})`;
      observe(run, "unplaced.convTax", Math.max(0, tax - placed), where);
      observe(
        run,
        "conv.taxSkip",
        tax > CENT && placed < CENT ? tax : 0,
        where,
      );
      return out;
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
  "reconcile.write",
  "handoff",
  "keepA",
  "sync.writeA",
  "sync.writeB",
  "unplaced.draw",
  "unplaced.conv",
  "unplaced.convTax",
  "conv.taxSkip",
  "conv.mopUp",
  "rb.identity",
] as const;
/** Counters judged by their bound: `over` is the stop. */
export const BOUNDED = ["ra.overwrite", "rb.growth", "rb.floor"] as const;
/** The synthetic-category run is judged on its ledger only (D2, D3). */
const BO1_JUDGED = new Set<string>(["d2", "d3", "d2.noPart", "d3.noPart"]);

/** Runs `fn` with fresh scope counters and returns them. */
export async function measure(
  fn: () => unknown,
  options: { forcedClass?: RunClass; damagePart?: boolean } = {},
): Promise<Tally> {
  proof.scope = emptyTally();
  proof.forcedClass = options.forcedClass;
  proof.damagePart = options.damagePart ?? false;
  try {
    await fn();
  } finally {
    proof.forcedClass = undefined;
    proof.damagePart = false;
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
