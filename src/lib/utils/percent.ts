/**
 * Format a decimal as a percentage string (e.g., 0.2189 → "21.89%").
 */
export function formatPercent(value: number, decimals = 0): string {
  return `${(value * 100).toFixed(decimals)}%`;
}
