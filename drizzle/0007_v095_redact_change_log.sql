-- Credentials never belong in the change log: logMutation logged each
-- mutation's raw input, so API keys and tokens saved before v0.9.5 sit there
-- in plaintext. Replace them (the keys in lib/utils/redact-secrets.ts —
-- keep the two lists together). Every credential input is a flat object,
-- so the top level is where they are. Safe to re-run: a redacted row
-- matches again and is rewritten to the same value.
UPDATE "change_log"
SET "new_value" = (
  SELECT jsonb_object_agg(
    e.key,
    CASE WHEN e.key IN ('accessToken', 'apiKey', 'setupToken', 'accessUrl', 'token', 'password', 'passwordHash', 'secret', 'clientSecret', 'config') THEN to_jsonb('[redacted]'::text) ELSE e.value END
  )
  FROM jsonb_each("change_log"."new_value") AS e
)
WHERE jsonb_typeof("new_value") = 'object'
  AND "new_value" ?| ARRAY['accessToken', 'apiKey', 'setupToken', 'accessUrl', 'token', 'password', 'passwordHash', 'secret', 'clientSecret', 'config'];
