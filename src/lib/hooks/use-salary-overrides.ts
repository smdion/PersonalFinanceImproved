"use client";

import { useScenario } from "@/lib/context/scenario-context";

/**
 * Extract the Plan/session tier's active salaries from the active scenario
 * context. Returns an array of { personId, salary } suitable for passing to
 * tRPC queries. These active values are stored in scenarios as
 * people/<personId>/salary — reading the generic scenario overrides store,
 * a separate, much larger mechanism this hook is not renaming.
 */
export function useActiveSalaries(): { personId: number; salary: number }[] {
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
