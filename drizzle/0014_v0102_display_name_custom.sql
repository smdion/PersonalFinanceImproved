-- `displayNameActive` becomes `displayNameCustom` in each profile entry, as
-- renameDisplayNameActive (lib/db/v0102-display-name-custom.ts) does on
-- restore; only entries holding the old key change. Safe to re-run.
UPDATE "contribution_profiles"
SET "contribution_active_fields" = jsonb_set(
  "contribution_active_fields",
  '{contributionAccounts}',
  (
    SELECT jsonb_object_agg(
      e.key,
      CASE
        WHEN jsonb_typeof(e.value) <> 'object' OR NOT (e.value ? 'displayNameActive') THEN e.value
        WHEN NOT (e.value ? 'displayNameCustom') AND jsonb_typeof(e.value -> 'displayNameActive') = 'string'
          THEN (e.value - 'displayNameActive') || jsonb_build_object('displayNameCustom', e.value -> 'displayNameActive')
        ELSE e.value - 'displayNameActive'
      END
    )
    FROM jsonb_each("contribution_active_fields" -> 'contributionAccounts') AS e
  )
)
WHERE jsonb_typeof("contribution_active_fields") = 'object'
  AND jsonb_typeof("contribution_active_fields" -> 'contributionAccounts') = 'object'
  AND EXISTS (
    SELECT 1
    FROM jsonb_each("contribution_active_fields" -> 'contributionAccounts') AS e
    WHERE jsonb_typeof(e.value) = 'object' AND e.value ? 'displayNameActive'
  );
