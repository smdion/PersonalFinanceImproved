/** The stored withdrawal strategy key, checked once on read. */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readStoredStrategy } from "@/lib/db/stored-strategy-key";

afterEach(() => vi.restoreAllMocks());

/** The events logged while `run` reads. */
function eventsDuring(run: () => void): unknown[] {
  const logged = vi.spyOn(console, "log").mockImplementation(() => {});
  run();
  const events = logged.mock.calls.map(([line]) => JSON.parse(String(line)));
  logged.mockRestore();
  return events;
}

describe("readStoredStrategy", () => {
  it("reads a key in the strategy set as is, without a log", () => {
    expect(
      eventsDuring(() =>
        expect(readStoredStrategy("guyton_klinger")).toBe("guyton_klinger"),
      ),
    ).toEqual([]);
  });

  it("logs a key outside the set and passes it on as stored", () => {
    const events = eventsDuring(() =>
      expect(readStoredStrategy("retired_strategy")).toBe("retired_strategy"),
    );
    expect(events).toEqual([
      expect.objectContaining({
        level: "warn",
        event: "withdrawal_strategy_unknown_key",
        stored: "retired_strategy",
      }),
    ]);
  });

  it("logs one unknown key once, and another key again", () => {
    expect(
      eventsDuring(() => {
        readStoredStrategy("old_key_a");
        readStoredStrategy("old_key_a");
      }),
    ).toHaveLength(1);
    expect(eventsDuring(() => readStoredStrategy("old_key_b"))).toHaveLength(1);
  });
});
