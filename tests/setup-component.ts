import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";
import { createElement } from "react";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

// Mock next/link to render a plain <a> tag
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: Record<string, unknown>) => {
    return createElement("a", { href, ...rest }, children as string);
  },
}));

// Each test file gets its own storage. Node's built-in localStorage is one
// file shared by every worker (vitest.config.ts), so a choice one test saved
// leaked into another test running at the same time.
class MemoryStorage implements Storage {
  private items = new Map<string, string>();
  get length() {
    return this.items.size;
  }
  clear() {
    this.items.clear();
  }
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  setItem(key: string, value: string) {
    this.items.set(key, String(value));
  }
}
const storage = new MemoryStorage();
for (const target of [globalThis, globalThis.window].filter(Boolean))
  Object.defineProperty(target, "localStorage", {
    value: storage,
    configurable: true,
  });
