/**
 * The engine input's `people` for a fixture that states one person by age:
 * person 1, born in January of the year the age gives (70½ then falls in
 * the year of 70, as for any January–June birth).
 */
export function onePerson(birthYear: number, personId = 1) {
  return [{ personId, birthYear, birthMonth: 1 }];
}
