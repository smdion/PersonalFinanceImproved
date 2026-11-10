/**
 * A cached budget month (budget_api_cache `months/YYYY-MM-01`) as read: in
 * the shape the clients write (the credentials migration clears any other).
 */
import { z } from "zod/v4";

const cachedMonthSchema = z.object({
  categories: z.array(z.object({ id: z.string(), balance: z.number() })),
});

/** Each category's balance by id. A month in another shape throws, naming
 *  the key and the paths that differ, never a value. */
export function readCachedMonthBalances(
  cacheKey: string,
  data: unknown,
): Map<string, number> {
  const parsed = cachedMonthSchema.safeParse(data);
  if (!parsed.success)
    throw new Error(
      `Cached budget month ${cacheKey} isn't in the clients' shape (${parsed.error.issues
        .slice(0, 5)
        .map((i) => i.path.join(".") || "(root)")
        .join(", ")})`,
    );
  return new Map(parsed.data.categories.map((c) => [c.id, c.balance]));
}
