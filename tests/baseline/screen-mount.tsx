/**
 * The screens baseline's harness: a seeded household, the page mount that
 * answers its queries, and the text a mounted page shows.
 *
 * Answers: the household is seeded into SQLite exactly as the router
 * baseline seeds it (seed.ts), and each query the page sends is called on
 * that household's router with the page's own input. `__baseline__/` holds
 * numbers only (no text, ids or dates) and only for procedures.ts's inputs,
 * which are not always the page's (a page adds its profile ids, overrides
 * or a sort), so the page can't be fed from the files themselves; it is fed
 * from the same procedures on the same database. Only the procedures the
 * router baseline calls are answered (procedures.ts PROCEDURES, plus
 * getProjectionMetadata, below); a query it skips answers nothing, as a
 * query still loading, and is listed in `unrecorded`; one that throws
 * answers nothing and is listed in the household's `gaps`.
 *
 * Import after ../routers/setup-mocks and ./mocks (the SQLite harness), and
 * mock `@/lib/trpc` with ../components/trpc-mock in the test file.
 */
import { afterAll, beforeAll, vi } from "vitest";
import { act, render } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import type { Caller, Household, SeededIds } from "./seed";
import { seedHousehold } from "./seed";
import { PROCEDURES } from "./procedures";
import { createTestCaller } from "../routers/setup";
import { BASELINE_NOW } from "./router-suite";
import {
  resetTrpcMock,
  setQuery,
  type QueryPath,
} from "../components/trpc-mock";

/** Key order and `undefined` fields don't change an input. */
export function canonical(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object" && !(v instanceof Date))
      return Object.fromEntries(
        Object.entries(v)
          .filter(([, item]) => item !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, item]) => [k, norm(item)]),
      );
    return v;
  };
  return JSON.stringify(norm(value ?? null));
}

/** A seeded household and the answers its pages have asked for. */
export interface ScreenHousehold {
  caller: Caller;
  ids: SeededIds;
  /** `path|input` → the router's response (`undefined`: it threw). */
  answers: Map<string, unknown>;
  /** Page queries left unanswered: `path input (why)`. */
  gaps: Set<string>;
  close: () => void;
}

/** Seed the household as the router baseline does. */
export async function openHousehold(
  household: Household,
): Promise<ScreenHousehold> {
  const { caller, cleanup } = await createTestCaller();
  const ids = await seedHousehold(caller, household);
  return { caller, ids, answers: new Map(), gaps: new Set(), close: cleanup };
}

/** The query paths answered: the ones the router baseline calls
 *  (procedures.ts), and getProjectionMetadata, which it skips as
 *  computeProjection's response with `result` null from the same function
 *  (the Retirement page reads it). */
const RECORDED = new Set([
  ...PROCEDURES.map((p) => p.path),
  "projection.getProjectionMetadata",
]);

/** Answer every recorded path from `h.answers`; a query not answered yet is
 *  added to `pending`. */
function answerFrom(h: ScreenHousehold, pending: Map<string, unknown>): void {
  resetTrpcMock();
  for (const path of RECORDED) {
    setQuery(
      path as QueryPath,
      ((input: unknown) => {
        const key = `${path}|${canonical(input)}`;
        if (h.answers.has(key)) return h.answers.get(key);
        pending.set(key, input);
        return undefined;
      }) as never,
    );
  }
}

/** `@/lib/trpc` for the screens: trpc-mock's, with every query on a path
 *  the baseline doesn't call noted in `unrecorded` as it is sent. */
export const unrecorded = new Set<string>();
export function screenTrpc(base: unknown, prefix: string[] = []): unknown {
  return new Proxy(base as object, {
    get: (target, prop) => {
      const value = (target as Record<PropertyKey, unknown>)[prop];
      if (typeof prop !== "string") return value;
      if (prop === "useQuery" || prop === "useSuspenseQuery") {
        const path = prefix.join(".");
        if (RECORDED.has(path)) return value;
        return (...args: unknown[]) => {
          const opts = args[1] as { enabled?: boolean } | undefined;
          if (opts?.enabled !== false)
            unrecorded.add(`${path} ${canonical(args[0])}`);
          return (value as (...a: unknown[]) => unknown)(...args);
        };
      }
      if (
        prop === "useUtils" ||
        prop === "useContext" ||
        prop === "useMutation"
      )
        return value;
      return screenTrpc(value, [...prefix, prop]);
    },
  });
}

async function callPath(
  caller: Caller,
  path: string,
  input: unknown,
): Promise<unknown> {
  let target: unknown = caller;
  for (const segment of path.split("."))
    target = (target as Record<string, unknown>)[segment];
  return (target as (input?: unknown) => Promise<unknown>)(input);
}

/** Wait until the page's text stops changing (lazy chunks, effects). */
export async function settle(container: HTMLElement): Promise<void> {
  let last = "";
  let same = 0;
  for (let i = 0; i < 50 && same < 3; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const now = container.innerHTML;
    same = now === last ? same + 1 : 0;
    last = now;
  }
}

/** The router baseline's clock, and no network, for the file's tests. */
export function freezeScreenClock(): void {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: BASELINE_NOW });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network disabled in baseline"))),
    );
  });
  afterAll(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
}

/** The app's providers (app/providers.tsx, minus the tRPC client the mock
 *  replaces) and the dashboard layout's: privacy off, an admin. Imported
 *  late, after the test file's mocks. */
export async function screenProviders(): Promise<
  ComponentType<{ children: ReactNode }>
> {
  const { PrivacyProvider } = await import("@/lib/context/privacy-context");
  const { UserProvider } = await import("@/lib/context/user-context");
  const { ScenarioProvider } = await import("@/lib/context/scenario-context");
  const { TooltipProvider } = await import("@/components/ui/tooltip");
  const { QueryClient, QueryClientProvider } =
    await import("@tanstack/react-query");
  const client = new QueryClient();
  return function Providers({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <TooltipProvider delayDuration={200} skipDelayDuration={100}>
          <PrivacyProvider initialPrivacy={false}>
            <UserProvider
              user={{ name: "Admin", role: "admin", permissions: [] }}
            >
              <ScenarioProvider>{children}</ScenarioProvider>
            </UserProvider>
          </PrivacyProvider>
        </TooltipProvider>
      </QueryClientProvider>
    );
  };
}

/**
 * Mount the page inside `Providers` until it asks for nothing new: each
 * query it sends (path and input) is called on the seeded household's
 * router and the page is mounted again with the answers, as a page opened
 * with a warm cache. Returns the last mount's container.
 */
export async function mountPage(
  h: ScreenHousehold,
  Page: ComponentType,
  Providers: ComponentType<{ children: ReactNode }>,
): Promise<HTMLElement> {
  for (let round = 0; ; round++) {
    const pending = new Map<string, unknown>();
    answerFrom(h, pending);
    const { container, unmount } = render(
      <Providers>
        <Page />
      </Providers>,
    );
    await settle(container);
    if (pending.size === 0) return container;
    unmount();
    if (round === 8) throw new Error("the page kept asking for new queries");
    for (const [key, input] of pending) {
      const path = key.slice(0, key.indexOf("|"));
      try {
        // Through JSON, as the app's tRPC link sends it (no transformer:
        // a Date arrives as its ISO string).
        const output = await callPath(h.caller, path, input);
        h.answers.set(
          key,
          output === undefined ? undefined : JSON.parse(JSON.stringify(output)),
        );
      } catch (error) {
        h.answers.set(key, undefined);
        h.gaps.add(`${path} ${canonical(input)} (threw: ${String(error)})`);
      }
    }
  }
}

const BLOCK = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "BUTTON",
  "CAPTION",
  "DD",
  "DETAILS",
  "DIALOG",
  "DIV",
  "DL",
  "DT",
  "FIELDSET",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "FORM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LABEL",
  "LEGEND",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "OPTION",
  "P",
  "PRE",
  "SECTION",
  "SELECT",
  "SUMMARY",
  "TABLE",
  "TBODY",
  "TD",
  "TFOOT",
  "TH",
  "THEAD",
  "TR",
  "UL",
]);

/** Elements whose text the reader never sees. */
function hidden(el: Element): boolean {
  return (
    el.classList.contains("sr-only") ||
    el.getAttribute("aria-hidden") === "true" ||
    el.tagName === "SCRIPT" ||
    el.tagName === "STYLE" ||
    el.tagName === "TEMPLATE"
  );
}

/**
 * The page's visible text in document order: one line per block element's
 * own run of text, whitespace collapsed, `.sr-only` and `aria-hidden`
 * subtrees left out. A form control's shown value (an input's value, a
 * select's chosen option) counts as text.
 */
export function screenText(root: HTMLElement): string {
  const lines: string[] = [];
  let run = "";
  const flush = () => {
    const line = run.replace(/\s+/g, " ").trim();
    if (line) lines.push(line);
    run = "";
  };
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      run += node.textContent ?? "";
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    if (hidden(el)) return;
    const block = BLOCK.has(el.tagName);
    if (block) flush();
    if (el.tagName === "INPUT") {
      const input = el as HTMLInputElement;
      if (input.type === "checkbox" || input.type === "radio")
        run += input.checked ? " [x] " : " [ ] ";
      else if (input.type !== "hidden" && input.type !== "file")
        run += ` [${input.value}] `;
    } else if (el.tagName === "TEXTAREA") {
      run += ` [${(el as HTMLTextAreaElement).value}] `;
    } else if (el.tagName === "SELECT") {
      const select = el as HTMLSelectElement;
      run += ` [${select.selectedOptions[0]?.textContent ?? ""}] `;
      flush();
      return; // the other options are not shown
    } else {
      for (const child of el.childNodes) walk(child);
    }
    if (block) flush();
  };
  walk(root);
  flush();
  return `${lines.join("\n")}\n`;
}
