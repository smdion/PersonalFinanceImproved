/**
 * The household's "current" glide path — the target mix for the money it
 * holds today, by age, kept apart from the glide path the retirement
 * simulation assumes (a household may hold a deliberately more
 * conservative mix than it projects with). Stored in app_settings
 * `current_glide_path`, validated on write with `currentGlidePathSchema`.
 */
import { z } from "zod/v4";

/** A row's shares may miss 100% by this much (rounding). */
const SUM_TOLERANCE = 0.005;

export const currentGlidePathSchema = z
  .array(
    z.object({
      age: z.number().int().min(0).max(120),
      /** Asset-class id → share of the portfolio (0–1). */
      allocations: z.record(
        z.string().regex(/^\d+$/),
        z.number().min(0).max(1),
      ),
    }),
  )
  .min(1)
  .max(40)
  .refine((rows) => new Set(rows.map((r) => r.age)).size === rows.length, {
    message: "Each age can appear once",
  })
  .refine(
    (rows) =>
      rows.every(
        (r) =>
          Math.abs(
            Object.values(r.allocations).reduce((s, v) => s + v, 0) - 1,
          ) <= SUM_TOLERANCE,
      ),
    { message: "Each age's mix must add up to 100%" },
  );

/** Stored setting → glide-path entries (oldest age first), or null when
 *  unset or unreadable (then the retirement glide path is the target). */
export function parseCurrentGlidePath(
  raw: unknown,
): { age: number; allocations: Record<number, number> }[] | null {
  const parsed = currentGlidePathSchema.safeParse(raw);
  if (!parsed.success) return null;
  return [...parsed.data]
    .sort((a, b) => a.age - b.age)
    .map((r) => ({
      age: r.age,
      allocations: Object.fromEntries(
        Object.entries(r.allocations).map(([id, v]) => [Number(id), v]),
      ),
    }));
}

/** Asset-class ids the glide path uses that aren't among `activeIds` — an
 *  asset class deleted or deactivated after the path was saved. Its share
 *  would silently drop out of the target and skew rebalancing amounts. */
export function unknownAssetClassIds(
  path: readonly { allocations: Record<number, number> }[],
  activeIds: ReadonlySet<number>,
): number[] {
  const unknown = new Set<number>();
  for (const row of path)
    for (const id of Object.keys(row.allocations).map(Number))
      if (!activeIds.has(id)) unknown.add(id);
  return [...unknown].sort((a, b) => a - b);
}
