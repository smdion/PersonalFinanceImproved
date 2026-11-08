/**
 * A stand-in for `@/lib/trpc` in component and hook tests (RULES §
 * Refactoring: "mount with mocked tRPC"). Every procedure exists: a query
 * answers with the data a test registered for its path (undefined
 * otherwise), a mutation records its calls and succeeds. Real hooks built on
 * tRPC (persisted settings, active profile, plans) run unchanged on top of it.
 *
 *   vi.mock("@/lib/trpc", async () => ({
 *     trpc: (await import("./trpc-mock")).trpc,
 *   }));
 *   import { setQuery, mutationCalls } from "./trpc-mock";
 *   setQuery("contributionProfile.list", profiles);
 *   expect(mutationCalls("contributionProfile.delete")).toEqual([{ id: 2 }]);
 *
 * Paths and data are typed against the router (`RouterOutputs`): a renamed
 * procedure, or data of the wrong shape, fails the type check. Data may be
 * partial (a test registers only what the component reads).
 *
 * Query data is returned by reference, so a hook's effect that depends on it
 * doesn't loop. A query registered as a function is called with the input
 * and its answer is cached per input. `useUtils()` is one stable object, as
 * in the app.
 */
import { vi, type Mock } from "vitest";
import type { RouterOutputs } from "@/lib/trpc";
import type { AppRouter } from "@/server/routers";

// ── Types: procedure paths and their outputs ────────────────────────────

type Inner<V> = V extends { _def: { record: infer R } } ? R : V;

type ProcedurePaths<R, Kind extends string, P extends string = ""> = {
  [K in keyof R & string]: R[K] extends { _def: { type: infer T } }
    ? T extends Kind
      ? `${P}${K}`
      : never
    : ProcedurePaths<Inner<R[K]>, Kind, `${P}${K}.`>;
}[keyof R & string];

type Record_ = Inner<AppRouter>;
/** Every query procedure, as `router.procedure`. */
export type QueryPath = ProcedurePaths<Record_, "query">;
/** Every mutation procedure, as `router.procedure`. */
export type MutationPath = ProcedurePaths<Record_, "mutation">;

type At<T, P extends string> = P extends `${infer H}.${infer Rest}`
  ? H extends keyof T
    ? At<T[H], Rest>
    : never
  : P extends keyof T
    ? T[P]
    : never;

/** Any part of `T`; a field may also be null (a fixture's "not set"). */
type DeepPartial<T> = T extends Date
  ? T
  : T extends readonly (infer U)[]
    ? DeepPartial<U>[]
    : T extends object
      ? { [K in keyof T]?: DeepPartial<T[K]> | null }
      : T;

/** What a test may register for a procedure: its output, any part of it. */
export type MockOutput<P extends string> = DeepPartial<At<RouterOutputs, P>>;

/** Fields of a query's result a test can set beyond its data. */
export interface QueryState {
  isLoading?: boolean;
  isPending?: boolean;
  isFetching?: boolean;
  isError?: boolean;
  isPlaceholderData?: boolean;
  error?: unknown;
}

/** Fields of a mutation's hook result a test can set. */
export interface MutationState {
  isPending?: boolean;
  isError?: boolean;
  isSuccess?: boolean;
  error?: unknown;
  data?: unknown;
}

// ── State ────────────────────────────────────────────────────────────────

type MutationOptions = {
  onSuccess?: (data: unknown, vars: unknown) => unknown;
  onError?: (error: unknown, vars: unknown) => unknown;
  onSettled?: (...args: unknown[]) => unknown;
};

/** One mutation call: its input, the hook's options and the call's own. */
interface Call {
  vars: unknown;
  opts: MutationOptions;
  callOpts?: MutationOptions;
}

type Answer = unknown;

const queries = new Map<string, Answer>();
const queryCache = new Map<string, unknown>();
const queryStates = new Map<string, QueryState>();
const queryInputs = new Map<string, Mock>();
const refetches = new Map<string, Mock>();
const mutations = new Map<string, Mock>();
const mutationResults = new Map<string, unknown>();
const mutationErrors = new Map<string, unknown>();
const mutationStates = new Map<string, MutationState>();
const held = new Map<string, Call[]>();
const utilsMocks = new Map<string, Mock>();

function mockFor(map: Map<string, Mock>, path: string): Mock {
  let m = map.get(path);
  if (!m) {
    m = vi.fn();
    map.set(path, m);
  }
  return m;
}

// ── Queries ──────────────────────────────────────────────────────────────

/** Data a query answers with (undefined: no data yet); a function receives
 *  the query input. */
export function setQuery<P extends QueryPath>(
  path: P,
  answer:
    | MockOutput<P>
    | ((input: never) => MockOutput<P> | null | undefined)
    | null
    | undefined,
): void;
export function setQuery(path: QueryPath, answer: unknown): void {
  queries.set(path, answer);
  for (const key of [...queryCache.keys()])
    if (key.startsWith(`${path}|`)) queryCache.delete(key);
}

/** The data a query answers with now (for `input`), after any `setData`. */
export function queryAnswer(path: QueryPath, input?: unknown): unknown {
  return queryData(path, input);
}

/** Loading, fetching or error fields a query's result carries. */
export function setQueryState(path: QueryPath, state: QueryState): void {
  queryStates.set(path, state);
}

/** The inputs each render's `useQuery` was called with, oldest first. */
export function queryCalls(path: QueryPath): unknown[] {
  return mockFor(queryInputs, path).mock.calls.map((c) => c[0]);
}

/** The options (`enabled`, …) each render's `useQuery` was called with. */
export function queryOptions(path: QueryPath): unknown[] {
  return mockFor(queryInputs, path).mock.calls.map((c) => c[1]);
}

/** The query result's `refetch` (one mock per path). */
export function queryRefetch(path: QueryPath): Mock {
  return mockFor(refetches, path);
}

function queryData(path: string, input: unknown): unknown {
  const answer = queries.get(path);
  if (typeof answer !== "function") return answer;
  const key = `${path}|${JSON.stringify(input ?? null)}`;
  if (!queryCache.has(key))
    queryCache.set(key, (answer as (i: unknown) => unknown)(input));
  return queryCache.get(key);
}

// ── Mutations ────────────────────────────────────────────────────────────

/** What a mutation's onSuccess receives (and mutateAsync resolves to); a
 *  function receives the mutation input. */
export function setMutationResult(
  path: MutationPath,
  result: (input: never) => unknown,
): void;
export function setMutationResult(path: MutationPath, result: unknown): void;
export function setMutationResult(path: MutationPath, result: unknown): void {
  mutationResults.set(path, result);
}

/** The mutation fails with `error`: onError runs, mutateAsync rejects. */
export function setMutationError(path: MutationPath, error: unknown): void {
  mutationErrors.set(path, error);
}

/** Fields the mutation's hook result carries (isPending, data, …). */
export function setMutationState(
  path: MutationPath,
  state: MutationState,
): void {
  mutationStates.set(path, state);
}

/** Calls are recorded but don't settle (no callbacks run, mutateAsync stays
 *  pending) until `settleMutation`. */
export function holdMutation(path: MutationPath): void {
  if (!held.has(path)) held.set(path, []);
}

/** Settles held calls: all of them, or the one at `index` (oldest first,
 *  among those still held). Success runs onSuccess and onSettled with the
 *  registered result; `error` runs onError and onSettled. The hook's
 *  callbacks run first, then the call's own (as in TanStack Query).
 *  Returns how many settled. */
export function settleMutation(
  path: MutationPath,
  { index, error }: { index?: number; error?: unknown } = {},
): number {
  const calls = held.get(path) ?? [];
  const settling =
    index === undefined ? calls.splice(0) : calls.splice(index, 1);
  // A failure is the component's to handle (onError): not an unhandled
  // rejection here.
  for (const call of settling) finish(path, call, error).catch(() => undefined);
  return settling.length;
}

/** The inputs each call of a mutation was given, oldest first. */
export function mutationCalls(path: MutationPath): unknown[] {
  return mockFor(mutations, path).mock.calls.map((c) => c[0]);
}

/** The per-call options (`mutate(input, { onSettled })`) of each call. */
export function mutationCallOptions(path: MutationPath): unknown[] {
  return mockFor(mutations, path).mock.calls.map((c) => c[1]);
}

function resultFor(path: string, vars: unknown): unknown {
  const answer = mutationResults.get(path) ?? {};
  return typeof answer === "function"
    ? (answer as (i: unknown) => unknown)(vars)
    : answer;
}

/** Runs a call's callbacks; resolves to its result or rejects. */
function finish(path: string, call: Call, error?: unknown): Promise<unknown> {
  const { vars } = call;
  const failed = error !== undefined;
  const result = failed ? undefined : resultFor(path, vars);
  for (const o of [call.opts, call.callOpts]) {
    if (!o) continue;
    if (failed) o.onError?.(error, vars);
    else o.onSuccess?.(result, vars);
    o.onSettled?.(result, failed ? error : null, vars);
  }
  return failed ? Promise.reject(error) : Promise.resolve(result);
}

// ── Utils ────────────────────────────────────────────────────────────────

/** The arguments each call of `utils.<path>` was given, e.g.
 *  `utilsCalls("settings.appSettings.list.invalidate")`. */
export function utilsCalls(path: string): unknown[][] {
  return mockFor(utilsMocks, path).mock.calls;
}

/** Every `utils` path called since the last reset, sorted, e.g. to pin a
 *  mutation's whole invalidation set. */
export function utilsCalledPaths(): string[] {
  return [...utilsMocks]
    .filter(([, m]) => m.mock.calls.length > 0)
    .map(([path]) => path)
    .sort();
}

/** Clears registered data and recorded calls (call in beforeEach). */
export function resetTrpcMock(): void {
  for (const m of [
    queries,
    queryCache,
    queryStates,
    queryInputs,
    refetches,
    mutations,
    mutationResults,
    mutationErrors,
    mutationStates,
    held,
    utilsMocks,
  ])
    m.clear();
}

// ── The stand-in ─────────────────────────────────────────────────────────

function procedure(path: string) {
  return {
    useQuery: (input?: unknown, opts?: { enabled?: boolean }) => {
      mockFor(queryInputs, path)(input, opts);
      const data = opts?.enabled === false ? undefined : queryData(path, input);
      return {
        data,
        isLoading: false,
        isPending: false,
        isFetching: false,
        isSuccess: data !== undefined,
        isError: false,
        isPlaceholderData: false,
        error: null,
        refetch: mockFor(refetches, path),
        ...queryStates.get(path),
      };
    },
    useSuspenseQuery: (input?: unknown) => [queryData(path, input), {}],
    useMutation: (opts: MutationOptions = {}) => {
      const run = (
        vars: unknown,
        callOpts?: MutationOptions,
      ): Promise<unknown> => {
        mockFor(mutations, path)(vars, callOpts);
        const call: Call = { vars, opts, callOpts };
        const hold = held.get(path);
        if (hold) {
          hold.push(call);
          return new Promise(() => {});
        }
        return finish(path, call, mutationErrors.get(path));
      };
      return {
        mutate: (vars: unknown, callOpts?: MutationOptions) => {
          void run(vars, callOpts).catch(() => undefined);
        },
        mutateAsync: run,
        isPending: false,
        isError: false,
        isSuccess: false,
        error: null,
        data: undefined,
        reset: vi.fn(),
        ...mutationStates.get(path),
      };
    },
  };
}

const utilsNodes = new Map<string, unknown>();

/** `utils.anything.deeply.invalidate()` etc.: every call is recorded and
 *  resolves; `fetch`/`ensureData` resolve to the query's registered data,
 *  `getData` returns it and `setData` replaces it. One proxy per path, so
 *  `useUtils()` is stable. */
function utilsProxy(prefix: string[] = []): unknown {
  const key = prefix.join(".");
  const cached = utilsNodes.get(key);
  if (cached) return cached;
  const node = new Proxy(() => undefined, {
    get: (_t, prop) =>
      prop === "then" || typeof prop !== "string"
        ? undefined
        : utilsProxy([...prefix, prop]),
    apply: (_t, _this, args: unknown[]) => {
      mockFor(utilsMocks, key)(...args);
      const method = prefix.at(-1);
      const path = prefix.slice(0, -1).join(".");
      if (method === "fetch" || method === "ensureData")
        return Promise.resolve(queryData(path, args[0]));
      if (method === "getData") return queryData(path, args[0]);
      if (method === "setData") {
        // The cache write a component makes (optimistic updates): it becomes
        // the query's registered data, for every input.
        const [input, updater] = args;
        const prev = queryData(path, input);
        const next =
          typeof updater === "function"
            ? (updater as (p: unknown) => unknown)(prev)
            : updater;
        setQuery(path as QueryPath, next as never);
        return undefined;
      }
      return Promise.resolve(undefined);
    },
  });
  utilsNodes.set(key, node);
  return node;
}

function router(prefix: string[]): unknown {
  return new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (typeof prop !== "string") return undefined;
        if (
          prefix.length === 0 &&
          (prop === "useUtils" || prop === "useContext")
        )
          return () => utilsProxy();
        if (
          prop === "useQuery" ||
          prop === "useMutation" ||
          prop === "useSuspenseQuery"
        )
          return procedure(prefix.join("."))[prop];
        return router([...prefix, prop]);
      },
    },
  );
}

export const trpc = router([]);
