/**
 * `contribution_active_fields` values before and after the
 * displayNameActive → displayNameCustom rename. One list for migration 0014
 * on both dialects and the restore step, so all three agree on every case.
 */
export type RenameCase = { name: string; before: unknown; after: unknown };

const accounts = (entries: Record<string, unknown>) => ({
  contributionAccounts: entries,
});

export const RENAME_CASES: RenameCase[] = [
  {
    name: "the old key alone moves to displayNameCustom",
    before: accounts({ "1": { displayNameActive: "Old", isActive: true } }),
    after: accounts({ "1": { displayNameCustom: "Old", isActive: true } }),
  },
  {
    name: "both keys: displayNameCustom stays, the old key goes",
    before: accounts({
      "2": { displayNameActive: "Old", displayNameCustom: "New" },
    }),
    after: accounts({ "2": { displayNameCustom: "New" } }),
  },
  {
    name: "an entry already converted is left as it is",
    before: accounts({ "3": { displayNameCustom: "Done" } }),
    after: accounts({ "3": { displayNameCustom: "Done" } }),
  },
  {
    name: "an entry without either key is left as it is",
    before: accounts({
      "4": { contributionValue: "6", contributionMethod: "percent_of_salary" },
    }),
    after: accounts({
      "4": { contributionValue: "6", contributionMethod: "percent_of_salary" },
    }),
  },
  {
    name: "an old key that is null or not text is dropped, nothing moves",
    before: accounts({
      "5": { displayNameActive: null, isActive: false },
      "6": { displayNameActive: 7 },
    }),
    after: accounts({ "5": { isActive: false }, "6": {} }),
  },
  {
    name: "a displayNameCustom stored as null is kept over the old text",
    before: accounts({
      "7": { displayNameActive: "Old", displayNameCustom: null },
    }),
    after: accounts({ "7": { displayNameCustom: null } }),
  },
  {
    name: "other entries and other keys of the column are kept",
    before: {
      contributionAccounts: {
        "8": { displayNameActive: "Roth", employerMatchValue: 1.5 },
        "9": { isActive: true },
        "10": "not an entry",
        "11": null,
        "12": [1, 2],
        "13": true,
        "14": JSON.stringify({ displayNameActive: "text, not an entry" }),
      },
      deductions: { "1": { isActive: false } },
    },
    after: {
      contributionAccounts: {
        "8": { displayNameCustom: "Roth", employerMatchValue: 1.5 },
        "9": { isActive: true },
        "10": "not an entry",
        "11": null,
        "12": [1, 2],
        "13": true,
        "14": JSON.stringify({ displayNameActive: "text, not an entry" }),
      },
      deductions: { "1": { isActive: false } },
    },
  },
  { name: "JSON null", before: null, after: null },
  { name: "an empty object", before: {}, after: {} },
  {
    name: "contributionAccounts null",
    before: { contributionAccounts: null },
    after: { contributionAccounts: null },
  },
  {
    name: "contributionAccounts not an object",
    before: { contributionAccounts: [{ displayNameActive: "x" }] },
    after: { contributionAccounts: [{ displayNameActive: "x" }] },
  },
  { name: "a column that is an array", before: [], after: [] },
];
