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
