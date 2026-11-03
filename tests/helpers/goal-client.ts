import { vi, type Mock } from "vitest";

/**
 * A budget client with only goal writes, as a push sees them: each
 * `prepareGoalWrite` resolves to an `apply()` that calls
 * `write(categoryId, amount)`. Pass `prepareError` to make every prepare
 * (the read before the write) fail with it.
 */
export function goalClient(
  write: Mock = vi.fn().mockResolvedValue(undefined),
  prepareError?: unknown,
) {
  return {
    prepareGoalWrite: vi.fn(
      async (
        categoryId: string,
        _shape: "monthly" | "target-balance",
        amount: number,
      ) => {
        if (prepareError !== undefined) throw prepareError;
        return { apply: () => write(categoryId, amount) as Promise<void> };
      },
    ),
  };
}
