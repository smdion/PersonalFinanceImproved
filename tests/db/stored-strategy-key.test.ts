/** The stored withdrawal strategy key, checked once on read. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readStoredStrategy } from "@/lib/db/stored-strategy-key";
import { log } from "@/lib/logger";

vi.mock("@/lib/logger", () => ({ log: vi.fn() }));

describe("readStoredStrategy", () => {
  beforeEach(() => vi.mocked(log).mockClear());

  it("reads a key in the strategy set as is, without a log", () => {
    expect(readStoredStrategy("guyton_klinger")).toBe("guyton_klinger");
    expect(log).not.toHaveBeenCalled();
  });

  it("logs a key outside the set and passes it on as stored", () => {
    expect(readStoredStrategy("retired_strategy")).toBe("retired_strategy");
    expect(log).toHaveBeenCalledWith(
      "warn",
      "withdrawal_strategy_unknown_key",
      { stored: "retired_strategy" },
    );
  });
});
