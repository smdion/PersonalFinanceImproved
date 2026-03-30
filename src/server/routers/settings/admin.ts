import { z } from "zod/v4";
import { eq, asc, desc, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  protectedProcedure,
  adminProcedure,
  scenarioProcedure,
  portfolioProcedure,
  performanceProcedure,
  savingsProcedure,
} from "../../trpc";
import * as schema from "@/lib/db/schema";
import { log } from "@/lib/logger";
import {
  ALL_PERMISSIONS,
  RBAC_SETTINGS_PREFIX,
  RBAC_ADMIN_GROUP_KEY,
} from "@/server/auth";
import { buildAccountLabel, accountDisplayName } from "@/lib/utils/format";
import {
  accountCategoryEnum,
  getAccountTypeConfig,
  parentCategoryEnum,
} from "@/lib/config/account-types";
import type { AccountCategory } from "@/lib/config/account-types";
import {
  PORTFOLIO_TAX_TYPE_VALUES,
  ACCOUNT_OWNERSHIP_VALUES,
  RETIREMENT_BEHAVIOR_VALUES,
  CONTRIBUTION_SCALING_VALUES,
} from "@/lib/config/enum-values";
import { zDecimal, settingValue, recomputeAnnualRollups } from "./_shared";
import {
  buildPrevInactiveKeys,
  resolveAccountActiveStatus,
  computeSnapshotEndingBalances,
  resolveSnapshotParentCategory,
} from "@/lib/pure/portfolio";
import { canDeletePerformanceAccount } from "@/lib/pure/profiles";
import {
  apiConfigSchema,
  accountMappingSchema,
  scenarioOverridesSchema,
  relocationScenarioParamsSchema,
} from "@/lib/db/json-schemas";

// --- Zod schemas ---

const appSettingInput = z.object({
  key: z.string().min(1),
  value: settingValue,
});

const portfolioSnapshotInput = z.object({
  snapshotDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().nullable().optional(),
  accounts: z.array(
    z.object({
      institution: z.string().trim().min(1),
      taxType: z.enum(PORTFOLIO_TAX_TYPE_VALUES),
      accountType: z.enum(accountCategoryEnum()),
      subType: z.string().nullable().optional(),
      label: z.string().trim().nullable().optional(),
      parentCategory: z.enum(parentCategoryEnum()).default("Retirement"),
      amount: zDecimal,
      ownerPersonId: z.number().int().nullable(),
      performanceAccountId: z.number().int().nullable().optional(),
    }),
  ),
});

const performanceAccountInput = z.object({
  institution: z.string().trim().min(1),
  accountType: z.string().min(1),
  subType: z.string().nullable().optional(),
  label: z.string().trim().nullable().optional(),
  displayName: z.string().trim().nullable().optional(),
  ownerPersonId: z.number().int().nullable().optional(),
  ownershipType: z.enum(ACCOUNT_OWNERSHIP_VALUES),
  retirementBehavior: z
    .enum(RETIREMENT_BEHAVIOR_VALUES)
    .default("stops_at_owner_retirement"),
  contributionScaling: z
    .enum(CONTRIBUTION_SCALING_VALUES)
    .default("scales_with_salary"),
  parentCategory: z.enum(parentCategoryEnum()),
  isActive: z.boolean().default(true),
  displayOrder: z.number().int().default(0),
});

/** Zod schema for numeric strings stored as TEXT in SQLite (e.g. financial amounts). */
const numericText = z
  .string()
  .min(1, "Must not be empty")
  .refine((v) => !Number.isNaN(Number(v)), "Must be a valid number");

const savingsGoalInput = z.object({
  name: z.string().min(1),
  parentGoalId: z.number().int().nullable().optional(),
  targetAmount: numericText.nullable().optional(),
  targetMonths: z.number().int().nullable().optional(),
  targetDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  priority: z.number().int().default(0),
  isActive: z.boolean().default(true),
  isEmergencyFund: z.boolean().default(false),
  targetMode: z.enum(["fixed", "ongoing"]).default("fixed"),
  monthlyContribution: numericText.default("0"),
  allocationPercent: numericText.nullable().optional(), // % of budget leftover
});

// --- Procedures ---

export const adminProcedures = {
  // ══ DATA FRESHNESS ══
  getDataFreshness: protectedProcedure.query(async ({ ctx }) => {
    const latestSnapshot = await ctx.db
      .select({ snapshotDate: schema.portfolioSnapshots.snapshotDate })
      .from(schema.portfolioSnapshots)
      .orderBy(desc(schema.portfolioSnapshots.snapshotDate))
      .limit(1);
    const perfSetting = await ctx.db
      .select({ value: schema.appSettings.value })
      .from(schema.appSettings)
      .where(eq(schema.appSettings.key, "performance_last_updated"));
    return {
      balanceDate: latestSnapshot[0]?.snapshotDate ?? null,
      performanceDate: (perfSetting[0]?.value as string) ?? null,
    };
  }),

  updateDataFreshness: adminProcedure
    .input(
      z.object({
        balanceDate: z.string().optional(),
        performanceDate: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.balanceDate) {
        // Update the most recent portfolio snapshot date
        const latest = await ctx.db
          .select({ id: schema.portfolioSnapshots.id })
          .from(schema.portfolioSnapshots)
          .orderBy(desc(schema.portfolioSnapshots.snapshotDate))
          .limit(1);
        if (latest[0]) {
          await ctx.db
            .update(schema.portfolioSnapshots)
            .set({ snapshotDate: input.balanceDate })
            .where(eq(schema.portfolioSnapshots.id, latest[0].id));
        }
      }
      if (input.performanceDate) {
        await ctx.db
          .insert(schema.appSettings)
          .values({
            key: "performance_last_updated",
            value: input.performanceDate,
          })
          .onConflictDoUpdate({
            target: schema.appSettings.key,
            set: { value: input.performanceDate },
          });
      }
      return { ok: true };
    }),

  // ══ APP SETTINGS ══
  appSettings: createTRPCRouter({
    list: protectedProcedure.query(async ({ ctx }) => {
      const rows = await ctx.db
        .select()
        .from(schema.appSettings)
        .orderBy(asc(schema.appSettings.key));
      // Non-admin users shouldn't see RBAC configuration
      if (ctx.session?.user?.role !== "admin") {
        return rows.filter(
          (r) =>
            !r.key.startsWith(RBAC_SETTINGS_PREFIX) &&
            r.key !== RBAC_ADMIN_GROUP_KEY,
        );
      }
      return rows;
    }),
    upsert: adminProcedure
      .input(appSettingInput)
      .mutation(async ({ ctx, input }) => {
        // value column is NOT NULL — when null, delete the row so the default applies
        if (input.value === null || input.value === undefined) {
          await ctx.db
            .delete(schema.appSettings)
            .where(eq(schema.appSettings.key, input.key));
          return null;
        }
        return ctx.db
          .insert(schema.appSettings)
          .values(input)
          .onConflictDoUpdate({
            target: schema.appSettings.key,
            set: { value: input.value },
          })
          .returning()
          .then((r) => r[0]);
      }),
    delete: adminProcedure
      .input(z.object({ key: z.string() }))
      .mutation(({ ctx, input }) =>
        ctx.db
          .delete(schema.appSettings)
          .where(eq(schema.appSettings.key, input.key)),
      ),
  }),

  // ══ RBAC GROUP MAPPING ══
  rbacGroups: createTRPCRouter({
    /** Get current RBAC group mapping (DB overrides merged with defaults). */
    get: adminProcedure.query(async ({ ctx }) => {
      const settings = await ctx.db.select().from(schema.appSettings);
      const map = new Map(settings.map((s) => [s.key, s.value]));

      const adminGroup =
        (typeof map.get(RBAC_ADMIN_GROUP_KEY) === "string"
          ? (map.get(RBAC_ADMIN_GROUP_KEY) as string)
          : null) || "ledgr-admin";

      const permissions = ALL_PERMISSIONS.map((perm) => {
        const override = map.get(`${RBAC_SETTINGS_PREFIX}${perm}`);
        return {
          permission: perm,
          group:
            (typeof override === "string" ? override : null) || `ledgr-${perm}`,
          isCustom: typeof override === "string",
        };
      });

      return {
        adminGroup,
        isAdminCustom: typeof map.get(RBAC_ADMIN_GROUP_KEY) === "string",
        permissions,
      };
    }),
  }),

  // ══ SCENARIOS (global what-if system) ══
  scenarios: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db.select().from(schema.scenarios).orderBy(asc(schema.scenarios.id)),
    ),
    create: scenarioProcedure
      .input(
        z.object({
          name: z.string().min(1),
          description: z.string().nullable().optional(),
          overrides: scenarioOverridesSchema.default({}),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.db
          .insert(schema.scenarios)
          .values(input)
          .returning()
          .then((r) => r[0]),
      ),
    update: scenarioProcedure
      .input(
        z.object({
          id: z.number().int(),
          name: z.string().min(1).optional(),
          description: z.string().nullable().optional(),
          overrides: scenarioOverridesSchema.optional(),
        }),
      )
      .mutation(({ ctx, input: { id, ...data } }) =>
        ctx.db
          .update(schema.scenarios)
          .set({ ...data, updatedAt: new Date() })
          .where(eq(schema.scenarios.id, id))
          .returning()
          .then((r) => r[0]),
      ),
    delete: scenarioProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(({ ctx, input }) =>
        ctx.db
          .delete(schema.scenarios)
          .where(eq(schema.scenarios.id, input.id)),
      ),
    /** Update a single override within a scenario's overrides JSONB */
    setOverride: scenarioProcedure
      .input(
        z.object({
          id: z.number().int(),
          entity: z.string(),
          recordId: z.string(),
          field: z.string(),
          value: settingValue,
        }),
      )
      .mutation(async ({ ctx, input }) => {
        // Use transaction + FOR UPDATE to prevent lost-write race conditions
        return ctx.db.transaction(async (tx) => {
          const [existing] = await tx
            .execute<
              typeof schema.scenarios.$inferSelect
            >(sql`SELECT * FROM scenarios WHERE id = ${input.id}`)
            .then((r) => r.rows);
          if (!existing) throw new Error("Scenario not found");
          const overrides = (existing.overrides ?? {}) as Record<
            string,
            Record<string, Record<string, unknown>>
          >;
          if (!overrides[input.entity]) overrides[input.entity] = {};
          if (!overrides[input.entity]![input.recordId])
            overrides[input.entity]![input.recordId] = {};
          overrides[input.entity]![input.recordId]![input.field] = input.value;
          return tx
            .update(schema.scenarios)
            .set({ overrides, updatedAt: new Date() })
            .where(eq(schema.scenarios.id, input.id))
            .returning()
            .then((r) => r[0]);
        });
      }),
    /** Remove a single override from a scenario */
    clearOverride: scenarioProcedure
      .input(
        z.object({
          id: z.number().int(),
          entity: z.string(),
          recordId: z.string(),
          field: z.string(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        // Use transaction + FOR UPDATE to prevent lost-write race conditions
        return ctx.db.transaction(async (tx) => {
          const [existing] = await tx
            .execute<
              typeof schema.scenarios.$inferSelect
            >(sql`SELECT * FROM scenarios WHERE id = ${input.id}`)
            .then((r) => r.rows);
          if (!existing) throw new Error("Scenario not found");
          const overrides = (existing.overrides ?? {}) as Record<
            string,
            Record<string, Record<string, unknown>>
          >;
          delete overrides[input.entity]?.[input.recordId]?.[input.field];
          // Clean up empty branches
          if (
            overrides[input.entity]?.[input.recordId] &&
            Object.keys(overrides[input.entity]![input.recordId]!).length === 0
          ) {
            delete overrides[input.entity]![input.recordId];
          }
          if (
            overrides[input.entity] &&
            Object.keys(overrides[input.entity]!).length === 0
          ) {
            delete overrides[input.entity];
          }
          return tx
            .update(schema.scenarios)
            .set({ overrides, updatedAt: new Date() })
            .where(eq(schema.scenarios.id, input.id))
            .returning()
            .then((r) => r[0]);
        });
      }),
  }),

  // ══ API CONNECTIONS ══
  apiConnections: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.apiConnections)
        .orderBy(asc(schema.apiConnections.service)),
    ),
    upsert: adminProcedure
      .input(
        z.object({
          service: z.string().min(1),
          config: apiConfigSchema,
          accountMappings: z.array(accountMappingSchema).nullable().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const existing = await ctx.db
          .select()
          .from(schema.apiConnections)
          .where(eq(schema.apiConnections.service, input.service));
        if (existing.length > 0) {
          return ctx.db
            .update(schema.apiConnections)
            .set(input)
            .where(eq(schema.apiConnections.service, input.service))
            .returning()
            .then((r) => r[0]);
        }
        return ctx.db
          .insert(schema.apiConnections)
          .values(input)
          .returning()
          .then((r) => r[0]);
      }),
    delete: adminProcedure
      .input(z.object({ service: z.string() }))
      .mutation(({ ctx, input }) =>
        ctx.db
          .delete(schema.apiConnections)
          .where(eq(schema.apiConnections.service, input.service)),
      ),
  }),

  // ══ SAVINGS GOALS ══
  savingsGoals: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.savingsGoals)
        .orderBy(asc(schema.savingsGoals.priority)),
    ),
    create: savingsProcedure
      .input(savingsGoalInput)
      .mutation(({ ctx, input }) =>
        ctx.db
          .insert(schema.savingsGoals)
          .values(input)
          .returning()
          .then((r) => r[0]),
      ),
    update: savingsProcedure
      .input(z.object({ id: z.number().int() }).extend(savingsGoalInput.shape))
      .mutation(({ ctx, input: { id, ...data } }) =>
        ctx.db
          .update(schema.savingsGoals)
          .set(data)
          .where(eq(schema.savingsGoals.id, id))
          .returning()
          .then((r) => r[0]),
      ),
    delete: savingsProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(({ ctx, input }) =>
        ctx.db
          .delete(schema.savingsGoals)
          .where(eq(schema.savingsGoals.id, input.id)),
      ),
  }),

  // ══ RELOCATION SCENARIOS ══
  relocationScenarios: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.relocationScenarios)
        .orderBy(desc(schema.relocationScenarios.updatedAt)),
    ),
    save: adminProcedure
      .input(
        z.object({
          id: z.number().int().optional(),
          name: z.string().min(1),
          params: relocationScenarioParamsSchema,
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (input.id) {
          return ctx.db
            .update(schema.relocationScenarios)
            .set({
              name: input.name,
              params: input.params,
              updatedAt: new Date(),
            })
            .where(eq(schema.relocationScenarios.id, input.id))
            .returning()
            .then((r) => r[0]);
        }
        return ctx.db
          .insert(schema.relocationScenarios)
          .values({ name: input.name, params: input.params })
          .returning()
          .then((r) => r[0]);
      }),
    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(({ ctx, input }) =>
        ctx.db
          .delete(schema.relocationScenarios)
          .where(eq(schema.relocationScenarios.id, input.id)),
      ),
  }),

  // ══ BACKFILL PERFORMANCE ACCOUNT IDS ══
  backfillPerformanceAccountIds: adminProcedure.mutation(async ({ ctx }) => {
    const [allContribs, allPerfAccounts, allPeople] = await Promise.all([
      ctx.db.select().from(schema.contributionAccounts),
      ctx.db.select().from(schema.performanceAccounts),
      ctx.db.select().from(schema.people),
    ]);

    const peopleMap = new Map(allPeople.map((p) => [p.id, p]));
    const needsBackfill = allContribs.filter(
      (c) => c.performanceAccountId === null,
    );

    let updated = 0;
    const unmatched: string[] = [];

    for (const contrib of needsBackfill) {
      const person = peopleMap.get(contrib.personId);
      const personName = person?.name?.toLowerCase() ?? "";
      const display = getAccountTypeConfig(
        contrib.accountType as AccountCategory,
      );
      const typeLabel =
        display?.displayLabel?.toLowerCase() ??
        contrib.accountType.toLowerCase();

      const match = allPerfAccounts.find((pa) => {
        const labelLower = (pa.accountLabel ?? "").toLowerCase();
        return (
          labelLower.includes(typeLabel) &&
          (pa.ownerPersonId === contrib.personId ||
            labelLower.includes(personName))
        );
      });

      if (match) {
        await ctx.db
          .update(schema.contributionAccounts)
          .set({ performanceAccountId: match.id })
          .where(eq(schema.contributionAccounts.id, contrib.id));
        updated++;
      } else {
        const desc = `contrib_account id=${contrib.id} (${contrib.accountType}, person=${person?.name ?? contrib.personId})`;
        unmatched.push(desc);
        log("warn", "admin_backfill_perf_id_unmatched", { description: desc });
      }
    }

    return {
      updated,
      unmatched,
      alreadyLinked: allContribs.length - needsBackfill.length,
    };
  }),

  // ══ PERFORMANCE ACCOUNTS (master registry) ══
  performanceAccounts: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.performanceAccounts)
        .orderBy(
          asc(schema.performanceAccounts.displayOrder),
          asc(schema.performanceAccounts.id),
        ),
    ),
    create: performanceProcedure
      .input(performanceAccountInput)
      .mutation(async ({ ctx, input }) => {
        // Resolve owner name for programmatic label
        let ownerName: string | null = null;
        if (input.ownerPersonId) {
          const [person] = await ctx.db
            .select({ name: schema.people.name })
            .from(schema.people)
            .where(eq(schema.people.id, input.ownerPersonId));
          ownerName = person?.name ?? null;
        }
        const accountLabel = buildAccountLabel({
          ownerName,
          accountType: input.accountType,
          subType: input.subType ?? null,
          label: input.label ?? null,
          institution: input.institution,
        });
        const [created] = await ctx.db
          .insert(schema.performanceAccounts)
          .values({
            ...input,
            accountLabel,
            ownerPersonId: input.ownerPersonId ?? null,
            subType: input.subType ?? null,
            label: input.label ?? null,
          })
          .returning();
        return created;
      }),
    update: performanceProcedure
      .input(
        z
          .object({ id: z.number().int() })
          .extend(performanceAccountInput.shape),
      )
      .mutation(async ({ ctx, input: { id, ...data } }) => {
        // Resolve owner name for programmatic label
        let ownerName: string | null = null;
        if (data.ownerPersonId) {
          const [person] = await ctx.db
            .select({ name: schema.people.name })
            .from(schema.people)
            .where(eq(schema.people.id, data.ownerPersonId));
          ownerName = person?.name ?? null;
        }
        const accountLabel = buildAccountLabel({
          ownerName,
          accountType: data.accountType,
          subType: data.subType ?? null,
          label: data.label ?? null,
          institution: data.institution,
        });
        // Wrap entire cascade in a transaction for atomicity
        return await ctx.db.transaction(async (tx) => {
          // 1. Update the master record
          const [updated] = await tx
            .update(schema.performanceAccounts)
            .set({
              ...data,
              accountLabel,
              ownerPersonId: data.ownerPersonId ?? null,
              subType: data.subType ?? null,
              label: data.label ?? null,
            })
            .where(eq(schema.performanceAccounts.id, id))
            .returning();
          if (!updated) return null;

          // 2. Cascade denormalized fields to accountPerformance rows
          await tx
            .update(schema.accountPerformance)
            .set({
              institution: updated.institution,
              accountLabel: updated.accountLabel,
              ownerPersonId: updated.ownerPersonId,
              parentCategory: updated.parentCategory,
            })
            .where(eq(schema.accountPerformance.performanceAccountId, id));

          // 3. Cascade parentCategory to linked contributionAccounts
          await tx
            .update(schema.contributionAccounts)
            .set({ parentCategory: updated.parentCategory })
            .where(eq(schema.contributionAccounts.performanceAccountId, id));

          // 4. Cascade parentCategory to linked portfolioAccounts
          await tx
            .update(schema.portfolioAccounts)
            .set({ parentCategory: updated.parentCategory })
            .where(eq(schema.portfolioAccounts.performanceAccountId, id));

          // 5. Recompute annual rollups for all affected years
          const affectedYears = await tx
            .select({ year: schema.accountPerformance.year })
            .from(schema.accountPerformance)
            .where(eq(schema.accountPerformance.performanceAccountId, id));
          const uniqueYears = Array.from(
            new Set(affectedYears.map((r) => r.year)),
          );
          for (const yr of uniqueYears) {
            await recomputeAnnualRollups(tx, yr);
          }

          // 6. Stamp performance_last_updated for cache invalidation
          const now = new Date().toISOString();
          await tx
            .insert(schema.appSettings)
            .values({ key: "performance_last_updated", value: now })
            .onConflictDoUpdate({
              target: schema.appSettings.key,
              set: { value: now },
            });

          return updated;
        });
      }),
    delete: performanceProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        // Pre-check: accountPerformance FK is RESTRICT — validate before hitting DB error
        const [perfCountRow] = await ctx.db
          .select({ count: sql<number>`count(*)` })
          .from(schema.accountPerformance)
          .where(eq(schema.accountPerformance.performanceAccountId, input.id));
        const perfCount = Number(perfCountRow?.count ?? 0);
        const deleteCheck = canDeletePerformanceAccount(perfCount);
        if (!deleteCheck.allowed) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: deleteCheck.reason!,
          });
        }

        // contributionAccounts and portfolioAccounts use SET NULL — they'll be unlinked
        await ctx.db
          .delete(schema.performanceAccounts)
          .where(eq(schema.performanceAccounts.id, input.id));
        return { success: true };
      }),
  }),

  // ══ PORTFOLIO SNAPSHOTS ══
  portfolioSnapshots: createTRPCRouter({
    /** Get the latest snapshot with its accounts (for pre-filling a new snapshot form). */
    getLatest: protectedProcedure.query(async ({ ctx }) => {
      const snapshots = await ctx.db
        .select()
        .from(schema.portfolioSnapshots)
        .orderBy(desc(schema.portfolioSnapshots.snapshotDate))
        .limit(1);
      const latest = snapshots[0];
      if (!latest) return null;
      const accounts = await ctx.db
        .select()
        .from(schema.portfolioAccounts)
        .where(eq(schema.portfolioAccounts.snapshotId, latest.id));
      return { snapshot: latest, accounts };
    }),

    /** Create a new snapshot with all its accounts in a single call. */
    create: portfolioProcedure
      .input(portfolioSnapshotInput)
      .mutation(async ({ ctx, input }) => {
        // Wrap all DB mutations in a transaction for atomicity.
        // Budget API push happens after (external side effect, not rollback-able).
        const snapshot = await ctx.db.transaction(async (tx) => {
          const rows = await tx
            .insert(schema.portfolioSnapshots)
            .values({
              snapshotDate: input.snapshotDate,
              notes: input.notes ?? null,
            })
            .returning();
          const snap = rows[0]!;
          if (input.accounts.length > 0) {
            // Build perfId → parentCategory map so parentCategory syncs from master
            const perfIds = input.accounts
              .map((a) => a.performanceAccountId)
              .filter((id): id is number => id != null);
            const perfCatMap = new Map<number, string>();
            if (perfIds.length > 0) {
              const perfRows = await tx
                .select({
                  id: schema.performanceAccounts.id,
                  parentCategory: schema.performanceAccounts.parentCategory,
                })
                .from(schema.performanceAccounts)
                .where(inArray(schema.performanceAccounts.id, perfIds));
              for (const p of perfRows) perfCatMap.set(p.id, p.parentCategory);
            }

            // Carry forward isActive from previous snapshot's matching accounts
            const prevSnapshots = await tx
              .select({ id: schema.portfolioSnapshots.id })
              .from(schema.portfolioSnapshots)
              .where(sql`${schema.portfolioSnapshots.id} != ${snap.id}`)
              .orderBy(desc(schema.portfolioSnapshots.snapshotDate))
              .limit(1);
            let prevInactiveKeys = new Set<string>();
            if (prevSnapshots.length > 0) {
              const prevAccounts = await tx
                .select({
                  performanceAccountId:
                    schema.portfolioAccounts.performanceAccountId,
                  taxType: schema.portfolioAccounts.taxType,
                  subType: schema.portfolioAccounts.subType,
                  isActive: schema.portfolioAccounts.isActive,
                })
                .from(schema.portfolioAccounts)
                .where(
                  eq(schema.portfolioAccounts.snapshotId, prevSnapshots[0]!.id),
                );
              prevInactiveKeys = buildPrevInactiveKeys(prevAccounts);
            }

            await tx.insert(schema.portfolioAccounts).values(
              input.accounts.map((a) => ({
                snapshotId: snap.id,
                institution: a.institution,
                taxType: a.taxType,
                accountType: a.accountType,
                subType: a.subType ?? null,
                label: a.label ?? null,
                parentCategory: resolveSnapshotParentCategory(
                  a.parentCategory,
                  a.performanceAccountId ?? null,
                  perfCatMap,
                ),
                amount: a.amount,
                ownerPersonId: a.ownerPersonId,
                performanceAccountId: a.performanceAccountId ?? null,
                isActive: resolveAccountActiveStatus(
                  {
                    performanceAccountId: a.performanceAccountId ?? null,
                    taxType: a.taxType,
                    subType: a.subType ?? null,
                  },
                  prevInactiveKeys,
                ),
              })),
            );
          }

          // Auto-update current-year performance ending balances
          const snapshotYear = parseInt(input.snapshotDate.substring(0, 4), 10);
          const currentYearAcctPerf = await tx
            .select()
            .from(schema.accountPerformance)
            .where(eq(schema.accountPerformance.year, snapshotYear));

          // Group snapshot accounts by performanceAccountId, sum amounts
          const perfTotals = computeSnapshotEndingBalances(
            input.accounts.map((a) => ({
              performanceAccountId: a.performanceAccountId ?? null,
              amount: a.amount,
            })),
          );

          // Update ending_balance for each matching account_performance row
          const updatedPerfIds = new Set<number>();
          for (const acctPerf of currentYearAcctPerf) {
            if (
              acctPerf.performanceAccountId &&
              perfTotals.has(acctPerf.performanceAccountId)
            ) {
              if (updatedPerfIds.has(acctPerf.performanceAccountId)) {
                log("warn", "snapshot_sync_duplicate_perf_row", {
                  acctPerfId: acctPerf.id,
                  performanceAccountId: acctPerf.performanceAccountId,
                  year: snapshotYear,
                });
                continue;
              }
              updatedPerfIds.add(acctPerf.performanceAccountId);
              const newBalance = perfTotals.get(acctPerf.performanceAccountId)!;
              await tx
                .update(schema.accountPerformance)
                .set({ endingBalance: newBalance.toFixed(2) })
                .where(eq(schema.accountPerformance.id, acctPerf.id));
            }
          }

          // Recompute annual_performance category rollups for this year
          if (perfTotals.size > 0) {
            await recomputeAnnualRollups(tx, snapshotYear);
            const now = new Date().toISOString();
            await tx
              .insert(schema.appSettings)
              .values({ key: "performance_last_updated", value: now })
              .onConflictDoUpdate({
                target: schema.appSettings.key,
                set: { value: now },
              });
          }

          return snap;
        });

        // Auto-pull portfolio balances from budget API for linked accounts (before push)
        let apiPullResult: { pulled: number; error?: string } = { pulled: 0 };
        try {
          const {
            getActiveBudgetApi: getActiveForPull,
            getApiConnection: getConnForPull,
          } = await import("@/lib/budget-api");
          const { getApiAccountBalanceMap: getMapForPull } =
            await import("@/server/helpers/api-balance-resolution");
          const activeForPull = await getActiveForPull(ctx.db);
          if (activeForPull !== "none") {
            const connForPull = await getConnForPull(ctx.db, activeForPull);
            const pullMappings = (connForPull?.accountMappings ?? []).filter(
              (m: { syncDirection: string; performanceAccountId?: number }) =>
                m.performanceAccountId != null &&
                (m.syncDirection === "pull" || m.syncDirection === "both"),
            );
            if (pullMappings.length > 0) {
              const pullBalanceMap = await getMapForPull(ctx.db, activeForPull);
              if (pullBalanceMap) {
                const pullSnapshotAccounts = await ctx.db
                  .select()
                  .from(schema.portfolioAccounts)
                  .where(eq(schema.portfolioAccounts.snapshotId, snapshot.id));
                let pulled = 0;
                for (const mapping of pullMappings) {
                  const m = mapping as {
                    remoteAccountId: string;
                    performanceAccountId?: number;
                  };
                  const apiBalance = pullBalanceMap.get(m.remoteAccountId);
                  if (apiBalance === undefined || !m.performanceAccountId)
                    continue;
                  const matchingRows = pullSnapshotAccounts.filter(
                    (a) => a.performanceAccountId === m.performanceAccountId,
                  );
                  if (matchingRows.length === 0) continue;
                  const currentTotal = matchingRows.reduce(
                    (s, a) => s + Number(a.amount),
                    0,
                  );
                  if (matchingRows.length === 1) {
                    await ctx.db
                      .update(schema.portfolioAccounts)
                      .set({ amount: String(apiBalance) })
                      .where(
                        eq(schema.portfolioAccounts.id, matchingRows[0]!.id),
                      );
                  } else {
                    const ratio =
                      currentTotal > 0 ? apiBalance / currentTotal : 0;
                    for (const row of matchingRows) {
                      const scaled = Number(row.amount) * ratio;
                      await ctx.db
                        .update(schema.portfolioAccounts)
                        .set({
                          amount: String(Math.round(scaled * 100) / 100),
                        })
                        .where(eq(schema.portfolioAccounts.id, row.id));
                    }
                  }
                  pulled++;
                }
                apiPullResult = { pulled };
              }
            }
          }
        } catch (e) {
          apiPullResult = {
            pulled: 0,
            error: e instanceof Error ? e.message : "Unknown error",
          };
        }

        // Auto-push to budget API tracking accounts if configured
        let apiSyncResult: {
          pushed: boolean;
          accountsPushed: number;
          error?: string;
        } = { pushed: false, accountsPushed: 0 };
        try {
          const { getActiveBudgetApi, getClientForService, getApiConnection } =
            await import("@/lib/budget-api");
          const active = await getActiveBudgetApi(ctx.db);
          if (active !== "none") {
            const conn = await getApiConnection(ctx.db, active);
            const mappings = conn?.accountMappings ?? [];
            const pushMappings = mappings.filter(
              (m: { syncDirection: string }) =>
                m.syncDirection === "push" || m.syncDirection === "both",
            );
            if (pushMappings.length > 0) {
              const client = await getClientForService(ctx.db, active);
              if (client) {
                const { getApiAccountBalanceMap } =
                  await import("@/server/helpers/api-balance-resolution");
                const apiBalanceMap =
                  (await getApiAccountBalanceMap(ctx.db, active)) ??
                  new Map<string, number>();
                // Build local balances for portfolio push
                const [snapshotAccounts, autoPushPeople, autoPushPerfAccounts] =
                  await Promise.all([
                    ctx.db
                      .select()
                      .from(schema.portfolioAccounts)
                      .where(
                        eq(schema.portfolioAccounts.snapshotId, snapshot.id),
                      ),
                    ctx.db.select().from(schema.people),
                    ctx.db.select().from(schema.performanceAccounts),
                  ]);
                const autoPushPeopleMap = new Map(
                  autoPushPeople.map((p) => [p.id, p.name]),
                );
                const autoPushPerfMap = new Map(
                  autoPushPerfAccounts.map((p) => [p.id, p]),
                );
                // Build balances keyed by performanceAccountId
                const balanceByPerfId = new Map<number, number>();
                for (const acct of snapshotAccounts) {
                  if (!acct.performanceAccountId) continue;
                  balanceByPerfId.set(
                    acct.performanceAccountId,
                    (balanceByPerfId.get(acct.performanceAccountId) ?? 0) +
                      Number(acct.amount),
                  );
                }
                let accountsPushed = 0;
                for (const mapping of pushMappings) {
                  const m = mapping as {
                    localId?: string;
                    localName: string;
                    remoteAccountId: string;
                    syncDirection: string;
                    performanceAccountId?: number;
                  };
                  // Resolve by typed field (preferred), legacy localId, or fall back to label matching
                  let localBal: number | undefined;
                  if (m.performanceAccountId != null) {
                    localBal = balanceByPerfId.get(m.performanceAccountId);
                  } else if (m.localId?.startsWith("performance:")) {
                    const perfId = parseInt(m.localId.split(":")[1]!, 10);
                    localBal = balanceByPerfId.get(perfId);
                  } else {
                    // Backward compat: fall back to label matching for unmigrated mappings
                    const autoPushPeopleMap2 = autoPushPeopleMap;
                    for (const acct of snapshotAccounts) {
                      const perf = acct.performanceAccountId
                        ? autoPushPerfMap.get(acct.performanceAccountId)
                        : null;
                      const ownerName = acct.ownerPersonId
                        ? autoPushPeopleMap2.get(acct.ownerPersonId)
                        : undefined;
                      const label = accountDisplayName(
                        {
                          accountType: acct.accountType,
                          subType: acct.subType,
                          label: acct.label,
                          institution: acct.institution,
                          displayName: perf?.displayName,
                          accountLabel: perf?.accountLabel,
                        },
                        ownerName ?? undefined,
                      );
                      if (label === m.localName) {
                        localBal = (localBal ?? 0) + Number(acct.amount);
                      }
                    }
                  }
                  if (localBal === undefined) continue;
                  const apiBal = apiBalanceMap.get(m.remoteAccountId) ?? 0;
                  const diff = localBal - apiBal;
                  if (Math.abs(diff) < 0.01) continue;
                  await client.createTransaction({
                    accountId: m.remoteAccountId,
                    date: input.snapshotDate,
                    amount: diff,
                    payeeName: "Portfolio Sync",
                    memo: `Portfolio snapshot ${input.snapshotDate}`,
                    cleared: true,
                    approved: true,
                  });
                  accountsPushed++;
                }
                apiSyncResult = { pushed: true, accountsPushed };
              }
            }
          }
        } catch (e) {
          apiSyncResult = {
            pushed: false,
            accountsPushed: 0,
            error: e instanceof Error ? e.message : "Unknown error",
          };
        }

        return { ...snapshot, apiSyncResult, apiPullResult };
      }),

    /** Update a single portfolio account row (e.g. change owner or toggle active). */
    updateAccount: portfolioProcedure
      .input(
        z.object({
          id: z.number().int(),
          ownerPersonId: z.number().int().nullable().optional(),
          isActive: z.boolean().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const updates: Record<string, unknown> = {};
        if (input.ownerPersonId !== undefined)
          updates.ownerPersonId = input.ownerPersonId;
        if (input.isActive !== undefined) updates.isActive = input.isActive;
        if (Object.keys(updates).length > 0) {
          await ctx.db
            .update(schema.portfolioAccounts)
            .set(updates)
            .where(eq(schema.portfolioAccounts.id, input.id));
        }
      }),

    /** Create a new sub-account row in the latest snapshot. */
    createAccount: portfolioProcedure
      .input(
        z.object({
          snapshotId: z.number().int(),
          institution: z.string().trim().min(1),
          taxType: z.enum(PORTFOLIO_TAX_TYPE_VALUES),
          amount: numericText,
          accountType: z.string().min(1),
          subType: z.string().nullable().optional(),
          label: z.string().trim().nullable().optional(),
          parentCategory: z.enum(parentCategoryEnum()).default("Retirement"),
          ownerPersonId: z.number().int().nullable().optional(),
          performanceAccountId: z.number().int().nullable().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const rows = await ctx.db
          .insert(schema.portfolioAccounts)
          .values({
            snapshotId: input.snapshotId,
            institution: input.institution,
            taxType: input.taxType,
            amount: input.amount,
            accountType: input.accountType,
            subType: input.subType ?? null,
            label: input.label ?? null,
            parentCategory: input.parentCategory,
            ownerPersonId: input.ownerPersonId ?? null,
            performanceAccountId: input.performanceAccountId ?? null,
            isActive: true,
          })
          .returning();
        return rows[0]!;
      }),

    /** Delete a snapshot (cascades to its accounts). */
    delete: portfolioProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(({ ctx, input }) =>
        ctx.db
          .delete(schema.portfolioSnapshots)
          .where(eq(schema.portfolioSnapshots.id, input.id)),
      ),
  }),
};
