/** Dave Ramsey recommended percentage ranges (of net take-home pay). */
export type RamseyRange = { name: string; low: number; high: number };

export const RAMSEY_RANGES: RamseyRange[] = [
  { name: "Housing", low: 0.25, high: 0.35 },
  { name: "Food", low: 0.1, high: 0.15 },
  { name: "Transportation", low: 0.1, high: 0.15 },
  { name: "Utilities", low: 0.05, high: 0.1 },
  { name: "Insurance", low: 0.1, high: 0.25 },
  { name: "Savings", low: 0.1, high: 0.15 },
  { name: "Personal", low: 0.1, high: 0.15 },
  { name: "Recreation", low: 0.05, high: 0.1 },
  { name: "Giving", low: 0.1, high: 0.15 },
  { name: "House Upkeep", low: 0.05, high: 0.1 },
];

/**
 * Default mapping from Ramsey range names → budget category names.
 * Stored as { [ramseyName]: budgetCategoryName[] } in app_settings['living_cost_mapping'].
 */
export const DEFAULT_LIVING_COST_MAPPING: Record<string, string[]> = {
  Housing: ["Housing", "Water/Sewer"],
  Food: ["Food"],
  Transportation: ["Transportation"],
  Utilities: ["Utilities"],
  Insurance: ["Insurance"],
  Savings: [
    "Savings",
    "Not in Emergency Fund",
    "Retirement",
    "Contributions",
    "Education",
  ],
  Personal: ["Personal", "Personal Care"],
  Recreation: ["Fun Money", "Recreation", "Travel"],
  Giving: ["Giving"],
  "House Upkeep": ["House Upkeep", "Maintenance"],
};
