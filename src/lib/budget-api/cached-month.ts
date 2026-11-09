/**
 * A cached budget month (budget_api_cache `months/YYYY-MM-01`) as read:
 * checked against the shape the clients write; a month that differs is
 * logged and the balances it holds in that shape are returned.
 */
import { z } from "zod/v4";
import { log } from "@/lib/logger";

const cachedMonthSchema = z.object({
  categories: z.array(z.object({ id: z.string(), balance: z.number() })),
});

/** Each category's balance by id. A category without a string id or a
 *  number balance is left out. */
export function readCachedMonthBalances(
  cacheKey: string,
  data: unknown,
): Map<string, number> {
  const issues = cachedMonthSchema.safeParse(data).error?.issues ?? [];
  if (issues.length > 0)
    log("warn", "budget_cache_month_unexpected_shape", {
      cacheKey,
      issues: issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".")}: ${i.message}`),
    });
  const categories =
    typeof data === "object" && data !== null && "categories" in data
      ? data.categories
      : undefined;
  const list: unknown[] = Array.isArray(categories) ? categories : [];
  const balances = new Map<string, number>();
  for (const category of list) {
    if (typeof category !== "object" || category === null) continue;
    const id = "id" in category ? category.id : undefined;
    const balance = "balance" in category ? category.balance : undefined;
    if (typeof id === "string" && typeof balance === "number")
      balances.set(id, balance);
  }
  return balances;
}
