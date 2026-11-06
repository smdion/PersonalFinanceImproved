-- `displayNameActive` becomes `displayNameCustom` in each profile entry
-- (see drizzle/0014). Safe to re-run.
UPDATE `contribution_profiles`
SET `contribution_active_fields` = json_set(
  `contribution_active_fields`,
  '$.contributionAccounts',
  json((
    SELECT json_group_object(
      e.key,
      CASE
        WHEN e.type <> 'object' THEN json(`contribution_active_fields` -> e.fullkey)
        WHEN json_type(e.value, '$.displayNameActive') IS NULL THEN json(e.value)
        WHEN json_type(e.value, '$.displayNameCustom') IS NULL AND json_type(e.value, '$.displayNameActive') = 'text'
          THEN json_set(json_remove(e.value, '$.displayNameActive'), '$.displayNameCustom', json_extract(e.value, '$.displayNameActive'))
        ELSE json_remove(e.value, '$.displayNameActive')
      END
    )
    FROM json_each(`contribution_active_fields`, '$.contributionAccounts') AS e
  ))
)
-- CASE, not AND: only valid JSON reaches json_type/json_each, whatever order
-- SQLite evaluates the conditions in.
WHERE CASE
  WHEN json_valid(`contribution_active_fields`) THEN
    json_type(`contribution_active_fields`) = 'object'
    AND json_type(`contribution_active_fields`, '$.contributionAccounts') = 'object'
    AND EXISTS (
      SELECT 1
      FROM json_each(`contribution_active_fields`, '$.contributionAccounts') AS e
      WHERE CASE WHEN e.type = 'object' THEN json_type(e.value, '$.displayNameActive') END IS NOT NULL
    )
  ELSE 0
END;
