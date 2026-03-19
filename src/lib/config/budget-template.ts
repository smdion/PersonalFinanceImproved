// Default budget template — pre-populates new profiles with standard household categories.
// Categories and subcategories mirror common budgeting frameworks (Dave Ramsey, YNAB).
// All amounts default to 0; users fill in their own numbers after creation.

export type BudgetTemplateItem = {
  category: string;
  subcategory: string;
  isEssential: boolean;
};

export const BUDGET_TEMPLATE: BudgetTemplateItem[] = [
  // Housing
  { category: "Housing", subcategory: "Mortgage/Rent", isEssential: true },
  { category: "Housing", subcategory: "Property Taxes", isEssential: true },
  { category: "Housing", subcategory: "HOA", isEssential: true },

  // Utilities
  { category: "Utilities", subcategory: "Electric", isEssential: true },
  { category: "Utilities", subcategory: "Gas", isEssential: true },
  { category: "Utilities", subcategory: "Water/Sewer", isEssential: true },
  { category: "Utilities", subcategory: "Internet", isEssential: true },
  { category: "Utilities", subcategory: "Cell Phone", isEssential: true },

  // Food
  { category: "Food", subcategory: "Groceries", isEssential: true },
  { category: "Food", subcategory: "Restaurants", isEssential: true },

  // Transportation
  { category: "Transportation", subcategory: "Fuel", isEssential: true },
  {
    category: "Transportation",
    subcategory: "Car Maintenance",
    isEssential: true,
  },

  // Insurance
  { category: "Insurance", subcategory: "Car Insurance", isEssential: true },
  {
    category: "Insurance",
    subcategory: "Homeowners Insurance",
    isEssential: true,
  },
  { category: "Insurance", subcategory: "Life Insurance", isEssential: true },

  // House Upkeep
  {
    category: "House Upkeep",
    subcategory: "General Household",
    isEssential: true,
  },
  {
    category: "House Upkeep",
    subcategory: "Home Improvement",
    isEssential: true,
  },
  { category: "House Upkeep", subcategory: "Lawn/Garden", isEssential: true },

  // Personal
  { category: "Personal", subcategory: "Clothing", isEssential: true },
  { category: "Personal", subcategory: "Self Care", isEssential: true },

  // Fun Money
  { category: "Fun Money", subcategory: "Subscriptions", isEssential: true },
  { category: "Fun Money", subcategory: "Entertainment", isEssential: true },
  { category: "Fun Money", subcategory: "Gifts", isEssential: true },

  // Non-essential (not counted in emergency fund)
  {
    category: "Not in Emergency Fund",
    subcategory: "Giving",
    isEssential: false,
  },
  {
    category: "Not in Emergency Fund",
    subcategory: "Investments",
    isEssential: false,
  },
];
