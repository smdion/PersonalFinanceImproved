import type { DeductionLine } from "@/lib/calculators/types";
import type { RawDeduction, DeductionRowData } from "./types";

/**
 * Build aligned deduction row lists for two people.
 * If one person has fewer deductions in a section, pad with placeholder rows
 * so the sections stay visually aligned side by side.
 */
export function alignDeductionRows(
  leftDeductions: DeductionLine[],
  leftRawDeductions: RawDeduction[],
  rightDeductions: DeductionLine[],
  rightRawDeductions: RawDeduction[],
  leftJobId: number,
  rightJobId: number,
): { left: DeductionRowData[]; right: DeductionRowData[] } {
  const findRaw = (deductions: RawDeduction[], name: string) =>
    deductions.find((d) => d.deductionName === name);

  // Collect all unique names in order (left first, then right)
  const allNames: string[] = [];
  for (const d of leftDeductions) {
    if (!allNames.includes(d.name)) allNames.push(d.name);
  }
  for (const d of rightDeductions) {
    if (!allNames.includes(d.name)) allNames.push(d.name);
  }

  const left: DeductionRowData[] = [];
  const right: DeductionRowData[] = [];

  for (const name of allNames) {
    const leftDed = leftDeductions.find((d) => d.name === name);
    const rightDed = rightDeductions.find((d) => d.name === name);

    if (leftDed) {
      left.push({
        type: "real",
        name,
        amount: leftDed.amount,
        raw: findRaw(leftRawDeductions, name),
      });
    } else {
      // Infer isPretax/ficaExempt from the other side's raw deduction
      const otherRaw = findRaw(rightRawDeductions, name);
      left.push({
        type: "placeholder",
        name,
        jobId: leftJobId,
        isPretax: otherRaw?.isPretax ?? true,
        ficaExempt: otherRaw?.ficaExempt ?? false,
      });
    }

    if (rightDed) {
      right.push({
        type: "real",
        name,
        amount: rightDed.amount,
        raw: findRaw(rightRawDeductions, name),
      });
    } else {
      // Infer isPretax/ficaExempt from the other side's raw deduction
      const otherRaw = findRaw(leftRawDeductions, name);
      right.push({
        type: "placeholder",
        name,
        jobId: rightJobId,
        isPretax: otherRaw?.isPretax ?? true,
        ficaExempt: otherRaw?.ficaExempt ?? false,
      });
    }
  }

  return { left, right };
}
