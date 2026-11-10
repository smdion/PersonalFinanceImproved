/**
 * The proxy turns a page request without a session away to /login (SE3):
 * before, it ran auth() with no `authorized` callback and blocked nothing.
 * Only `next dev` (devBypass) and DEMO_ONLY skip sign-in, as everywhere else.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Authorized = (args: { auth: unknown }) => boolean;
const captured = vi.hoisted(() => ({ authorized: null as Authorized | null }));
vi.mock("next-auth", () => ({
  default: (config: { callbacks?: { authorized?: Authorized } }) => {
    captured.authorized = config.callbacks?.authorized ?? null;
    return { auth: vi.fn() };
  },
}));
vi.mock("@/server/auth.config", () => ({
  authConfig: { providers: [], pages: { signIn: "/login" } },
}));

const session = { user: { name: "A" }, expires: "2099-01-01T00:00:00Z" };

async function authorized() {
  vi.resetModules();
  captured.authorized = null;
  await import("@/proxy");
  // Set by the mocked NextAuth while the module loads.
  const callback = captured.authorized as Authorized | null;
  if (!callback) throw new Error("no authorized callback");
  return callback;
}

beforeEach(() => vi.stubEnv("NODE_ENV", "production"));
afterEach(() => vi.unstubAllEnvs());

describe("proxy: authorized", () => {
  it("refuses a request with no session", async () => {
    expect((await authorized())({ auth: null })).toBe(false);
  });

  it("lets a signed-in request through", async () => {
    expect((await authorized())({ auth: session })).toBe(true);
  });

  it("lets every request through under next dev, as the layout does", async () => {
    vi.stubEnv("NODE_ENV", "development");
    expect((await authorized())({ auth: null })).toBe(true);
  });
});

describe("proxy: matcher", () => {
  it("leaves the sign-in page's own files alone", async () => {
    vi.resetModules();
    const { config } = await import("@/proxy");
    const [pattern] = config.matcher;
    const matches = (path: string) => new RegExp(`^${pattern}$`).test(path);
    expect(matches("/login")).toBe(false);
    expect(matches("/icon.svg")).toBe(false);
    expect(matches("/api/trpc/x")).toBe(false);
    expect(matches("/_next/static/chunk.js")).toBe(false);
    expect(matches("/")).toBe(true);
    expect(matches("/paycheck")).toBe(true);
    expect(matches("/demo")).toBe(true);
  });
});
