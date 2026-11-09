/**
 * A parsed tax-data file checked before anything reads it as one: every
 * check in validate.ts, then the structure its type promises.
 */
import { z } from "zod/v4";
import type { TaxDataFile } from "@/lib/db/migrate/reference-reconcile-core";
import { validateTaxDataFile } from "@/lib/tax-data/validate";

const exceptionShape = z.object({ reason: z.string(), source: z.string() });
const bracketSectionShape = z.looseObject({
  source: z.string(),
  brackets: z.record(z.string(), z.array(z.unknown())),
  supersedes: z.record(z.string(), z.array(z.array(z.unknown()))).optional(),
  exception: exceptionShape.optional(),
});

/** The file's structure as its type has it; the figures are validate.ts's
 *  to check, and keys it doesn't name are kept. */
const taxDataFileShape: z.ZodType<TaxDataFile> = z.looseObject({
  formatVersion: z.number(),
  dataVersion: z.number(),
  years: z.record(
    z.string(),
    z.looseObject({
      revision: z.number(),
      source: z.string(),
      notes: z.string().optional(),
      sources: z.record(z.string(), z.string()).optional(),
      limits: z.record(
        z.string(),
        z.looseObject({
          value: z.number(),
          source: z.string(),
          notes: z.string().optional(),
          supersedes: z.array(z.number()).optional(),
          exception: exceptionShape.optional(),
        }),
      ),
      withholding: z.looseObject({
        source: z.string(),
        notes: z.string().optional(),
        tables: z.record(
          z.string(),
          z.looseObject({
            standard: z.array(z.unknown()),
            checkbox: z.array(z.unknown()),
          }),
        ),
        supersedes: z
          .record(
            z.string(),
            z.looseObject({
              standard: z.array(z.array(z.unknown())).optional(),
              checkbox: z.array(z.array(z.unknown())).optional(),
            }),
          )
          .optional(),
        exception: exceptionShape.optional(),
      }),
      ltcg: bracketSectionShape.optional(),
      irmaa: bracketSectionShape.optional(),
      fpl: z
        .looseObject({
          source: z.string(),
          amounts: z.record(z.string(), z.number()),
          supersedes: z.array(z.record(z.string(), z.number())).optional(),
          exception: exceptionShape.optional(),
        })
        .optional(),
    }),
  ),
});

function hasFileStructure(value: unknown): value is TaxDataFile {
  return taxDataFileShape.safeParse(value).success;
}

/** Any parsed value checked: the file itself (never a parsed copy) when it
 *  passes every check and has the file's structure, else its problems. */
export function checkTaxDataFile(
  value: unknown,
  options: Parameters<typeof validateTaxDataFile>[1],
): { file: TaxDataFile; problems: [] } | { file: null; problems: string[] } {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the checks read any value through ?./?? and report what is missing; the structure is proven below
  const problems = validateTaxDataFile(value as TaxDataFile, options);
  if (problems.length > 0) return { file: null, problems };
  if (hasFileStructure(value)) return { file: value, problems: [] };
  const issues = taxDataFileShape.safeParse(value).error?.issues ?? [];
  return {
    file: null,
    problems: issues.map((i) => `structure ${i.path.join(".")}: ${i.message}`),
  };
}
