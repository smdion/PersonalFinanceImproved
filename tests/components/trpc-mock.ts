/**
 * A stand-in for `@/lib/trpc` in component smoke tests (RULES § Refactoring:
 * "mount with mocked tRPC"). Every procedure exists: a query answers with
 * the data a test registered for its path (undefined otherwise), a mutation
 * records its calls. Real hooks built on tRPC (persisted settings, active
 * profile, plans) run unchanged on top of it.
 *
 *   vi.mock("@/lib/trpc", async () => ({
 *     trpc: (await import("./trpc-mock")).trpc,
 *   }));
 *   import { setQuery, mutationCalls } from "./trpc-mock";
 *   setQuery("contributionProfile.list", profiles);
 *   expect(mutationCalls("contributionProfile.delete")).toEqual([{ id: 2 }]);
 *
 * Query data is returned by reference, so a hook's effect that depends on it
 * doesn't loop. A query registered as a function is called with the input
 * and its answer is cached per input.
 */
import { vi, type Mock } from "vitest";

type QueryAnswer = unknown | ((input: unknown) => unknown);

const queries = new Map<string, QueryAnswer>();
const queryCache = new Map<string, unknown>();
const mutations = new Map<string, Mock>();
const mutationResults = new Map<string, unknown>();

/** Data a query answers with; a function receives the query input. */
export function setQuery(
  path: string,
  answer: (input: unknown) => unknown,
): void;
export function setQuery(path: string, answer: unknown): void;
export function setQuery(path: string, answer: QueryAnswer): void {
  queries.set(path, answer);
  for (const key of [...queryCache.keys()])
    if (key.startsWith(`${path}|`)) queryCache.delete(key);
}

/** What a mutation's onSuccess receives (and mutateAsync resolves to); a
 *  function receives the mutation input. */
export function setMutationResult(
  path: string,
  result: (input: unknown) => unknown,
): void;
export function setMutationResult(path: string, result: unknown): void;
export function setMutationResult(path: string, result: unknown): void {
  mutationResults.set(path, result);
}

function mutationMock(path: string): Mock {
  let m = mutations.get(path);
  if (!m) {
    m = vi.fn();
    mutations.set(path, m);
  }
  return m;
}

/** The inputs each call of a mutation was given, oldest first. */
export function mutationCalls(path: string): unknown[] {
  return mutationMock(path).mock.calls.map((c) => c[0]);
}

/** Clears registered data and recorded calls (call in beforeEach). */
export function resetTrpcMock(): void {
  queries.clear();
  queryCache.clear();
  mutations.clear();
  mutationResults.clear();
}

function queryData(path: string, input: unknown): unknown {
  const answer = queries.get(path);
  if (typeof answer !== "function") return answer;
  const key = `${path}|${JSON.stringify(input ?? null)}`;
  if (!queryCache.has(key))
    queryCache.set(key, (answer as (i: unknown) => unknown)(input));
  return queryCache.get(key);
}

type MutationOptions = {
  onSuccess?: (data: unknown, vars: unknown) => unknown;
  onSettled?: (...args: unknown[]) => unknown;
};

function procedure(path: string) {
  return {
    useQuery: (input?: unknown, opts?: { enabled?: boolean }) => {
      const data = opts?.enabled === false ? undefined : queryData(path, input);
      return {
        data,
        isLoading: false,
        isPending: false,
        isFetching: false,
        isSuccess: data !== undefined,
        isError: false,
        error: null,
        refetch: vi.fn(),
      };
    },
    useSuspenseQuery: (input?: unknown) => [queryData(path, input), {}],
    useMutation: (opts: MutationOptions = {}) => {
      const run = (vars: unknown) => {
        mutationMock(path)(vars);
        const answer = mutationResults.get(path) ?? {};
        const result =
          typeof answer === "function"
            ? (answer as (i: unknown) => unknown)(vars)
            : answer;
        opts.onSuccess?.(result, vars);
        opts.onSettled?.(result, null, vars);
        return result;
      };
      return {
        mutate: run,
        mutateAsync: async (vars: unknown) => run(vars),
        isPending: false,
        isError: false,
        isSuccess: false,
        error: null,
        reset: vi.fn(),
      };
    },
  };
}

/** `utils.anything.deeply.invalidate()` etc.: every call resolves;
 *  `utils.<path>.fetch(input)` resolves to that query's registered data. */
function utilsProxy(prefix: string[] = []): unknown {
  const fn = () => undefined;
  return new Proxy(fn, {
    get: (_t, prop) =>
      prop === "then" || typeof prop !== "string"
        ? undefined
        : utilsProxy([...prefix, prop]),
    apply: (_t, _this, args: unknown[]) => {
      const method = prefix.at(-1);
      const path = prefix.slice(0, -1).join(".");
      if (method === "fetch" || method === "ensureData")
        return Promise.resolve(queryData(path, args[0]));
      if (method === "getData") return queryData(path, args[0]);
      return Promise.resolve(undefined);
    },
  });
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
