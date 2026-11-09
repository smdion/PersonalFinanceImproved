/** Names the profiles that already hold a value for the reused account. */
export function renderProfilesNote(
  linkedExistingId: number,
  profileNamesFor: (accountId: number) => string[],
) {
  const names = profileNamesFor(linkedExistingId);
  return names.length > 0
    ? ` Note: ${names.join(", ")} ${names.length > 1 ? "have" : "has"} a value set for this account.`
    : "";
}
