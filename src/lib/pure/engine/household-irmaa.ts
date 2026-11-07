import { checkIrmaa, type IrmaaInput } from "./irmaa-check";

/**
 * The household's IRMAA surcharge: `checkIrmaa`'s per-person cost times the
 * people 65 or older. The caller picks the MAGI and the conversion amount.
 */
export function checkHouseholdIrmaa(
  input: Omit<IrmaaInput, "anyPersonAge65"> & { personsAge65Plus: number },
): ReturnType<typeof checkIrmaa> {
  const { personsAge65Plus, ...rest } = input;
  const perPerson = checkIrmaa({
    ...rest,
    anyPersonAge65: personsAge65Plus > 0,
  });
  return {
    irmaaCost: perPerson.irmaaCost * personsAge65Plus,
    warnings: perPerson.warnings,
  };
}
