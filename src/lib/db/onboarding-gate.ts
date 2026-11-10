/** Whether onboarding keeps the first-admin gate closed (with no local admin):
 *  the stored flag when set, else whether a person exists. first-run.ts reads
 *  it, and a restore or import keeps today's closed gate closed by it. */
export function onboardingClosesGate(
  flag: boolean | null,
  peopleExist: boolean,
): boolean {
  return flag ?? peopleExist;
}
