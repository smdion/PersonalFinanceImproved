import { useScenario } from "@/lib/context/scenario-context";

/**
 * Extract salary overrides from the active scenario context.
 * Returns an array of { personId, salary } suitable for passing to tRPC queries.
 * Salary overrides are stored in scenarios as people/<personId>/salary.
 */
export function useSalaryOverrides(): { personId: number; salary: number }[] {
  const { activeScenario } = useScenario();
  if (!activeScenario) return [];

  const peopleOverrides = activeScenario.overrides?.people;
  if (!peopleOverrides) return [];

  const result: { personId: number; salary: number }[] = [];
  for (const [recordId, fields] of Object.entries(peopleOverrides)) {
    if (fields?.salary !== undefined) {
      result.push({
        personId: Number(recordId),
        salary: Number(fields.salary),
      });
    }
  }
  return result;
}
