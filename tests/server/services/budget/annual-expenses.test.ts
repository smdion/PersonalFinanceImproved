/**
 * getAnnualExpensesFromBudget against a test database.
 */
import "../../../helpers/setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getAnnualExpensesFromBudget } from "@/server/services/budget/annual-expenses";
import { createTestDb, type TestDbContext } from "../../../helpers/db-harness";

// ---------------------------------------------------------------------------
// getAnnualExpensesFromBudget (DB-dependent)
// ---------------------------------------------------------------------------

describe("getAnnualExpensesFromBudget", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await createTestDb();
  });

  afterAll(() => ctx.cleanup());

  it("returns 0 when no budget profiles exist", async () => {
    const result = await getAnnualExpensesFromBudget(ctx.rawDb, new Date());
    expect(result).toBe(0);
  });

  it("computes annual total from active profile", async () => {
    // Create an active budget profile
    const profile = ctx.db
      .insert(ctx.schema.budgetProfiles)
      .values({
        name: "Test Budget",
        isActive: true,
        columnLabels: ["Standard"],
        columnMonths: null,
      })
      .returning()
      .get();

    // Add budget items
    ctx.db
      .insert(ctx.schema.budgetItems)
      .values([
        {
          profileId: profile.id,
          category: "Housing",
          subcategory: "Rent",
          amounts: [2000],
        },
        {
          profileId: profile.id,
          category: "Food",
          subcategory: "Groceries",
          amounts: [500],
        },
      ])
      .run();

    const result = await getAnnualExpensesFromBudget(ctx.rawDb, new Date());
    // (2000 + 500) × 12 = 30000
    expect(result).toBe(30000);
  });

  it("respects budget_active_column setting", async () => {
    // Add a second column of amounts to items
    const profile = ctx.db.select().from(ctx.schema.budgetProfiles).all()[0]!;

    // Update profile to have two columns
    ctx.db
      .update(ctx.schema.budgetProfiles)
      .set({ columnLabels: ["Low", "High"] })
      .run();

    // Delete existing items and recreate with 2 columns
    ctx.db.delete(ctx.schema.budgetItems).run();
    ctx.db
      .insert(ctx.schema.budgetItems)
      .values([
        {
          profileId: profile.id,
          category: "Housing",
          subcategory: "Rent",
          amounts: [2000, 2500],
        },
        {
          profileId: profile.id,
          category: "Food",
          subcategory: "Groceries",
          amounts: [500, 600],
        },
      ])
      .run();

    // Set active column to 1
    ctx.db
      .insert(ctx.schema.appSettings)
      .values({ key: "budget_active_column", value: 1 })
      .run();

    const result = await getAnnualExpensesFromBudget(ctx.rawDb, new Date());
    // Column 1: (2500 + 600) × 12 = 37200
    expect(result).toBe(37200);

    // Stored as a digit string (an older PostgreSQL write): still column 1,
    // not column 0's (2000 + 500) × 12 = 30000.
    ctx.db.update(ctx.schema.appSettings).set({ value: "1" }).run();
    expect(await getAnnualExpensesFromBudget(ctx.rawDb, new Date())).toBe(
      37200,
    );
  });
});
