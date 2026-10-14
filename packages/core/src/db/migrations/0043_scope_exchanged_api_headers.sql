-- Move API protocol headers out of the egress delivery rules and into
-- app_config.api_protocol_headers.
--
-- The egress door matches on host alone, so a delivery rule is host-scoped by
-- construction. Content-negotiation headers are scoped to the API surface, and a
-- rule for one was therefore applied to every request to the host: one app
-- answered `GET /app` with 404 and an empty body instead of the page, so the
-- agent read "logged out", signed in again (successfully, four times) and never
-- recovered.
--
-- Two statements, in this order so nothing is dropped before it is recorded:
--   1. record the headers where a caller can read them, from the sign-in recipe,
--      which is the only place their VALUES exist in plaintext — the exchanged
--      copies live encrypted in connections.credentials and are unreadable here
--   2. remove exactly the rules statement 1 recorded
--
-- Statement 2's predicate is DERIVED from the recipe rather than from a list of
-- header names, so it deletes a rule only when statement 1 has already recorded
-- that header's value. Three shapes depend on that and silently lost data under a
-- hardcoded name list:
--   · a vendor whose protocol header is not one of ours (Accept-Version,
--     X-Client-Version) kept its host-wide rule, so the 404 bug survived AND the
--     header was published — sent twice
--   · a recipe with no always_send_headers had its rules deleted with nothing
--     recorded anywhere
--   · a rule that places its value somewhere other than a header (a query or body
--     rule, which credential_delivery_rule_schema fully allows) has a NULL
--     put_it_in_header; under `NOT (true AND NULL)` SQL three-valued logic
--     evaluates to NULL and jsonb_agg dropped the row, deleting an unrelated
--     OAuth rule this migration was never meant to touch. Hence the coalesces.
--
-- Rules a person wrote by hand (worked_out_by neither 'login' nor 'oauth') are
-- never touched: their scope was chosen deliberately and is not ours to narrow.
--
-- Statement 1 records only headers that cannot carry a credential. A recipe's
-- always_send_headers is authored by an agent reading a web page, and this field
-- is published to callers and into the model's prompt, so an Authorization or
-- X-Api-Key that found its way in there must not be copied out to a
-- prompt-visible place. Its delivery rule is then left alone by statement 2,
-- because statement 2 only removes what statement 1 recorded.
--
-- Idempotent. Statement 1 re-derives the same value; statement 2 finds nothing
-- left to remove. The next successful sign-in overwrites both keys wholesale.

UPDATE "apps" SET "app_config" = "app_config" || jsonb_build_object(
  'api_protocol_headers',
  coalesce(
    (
      SELECT jsonb_object_agg(header_name, header_value)
      FROM jsonb_each_text(
        "app_config"->'exchange_the_credential_by'->'recipe'->'always_send_headers'
      ) AS recipe_header(header_name, header_value)
      WHERE lower(header_name) NOT IN (
        'authorization', 'proxy-authorization', 'cookie', 'set-cookie'
      )
      AND lower(header_name) !~ '(key|token|secret|auth|session|credential|password)'
    ),
    '{}'::jsonb
  )
)
WHERE jsonb_typeof(
  "app_config"->'exchange_the_credential_by'->'recipe'->'always_send_headers'
) = 'object';
--> statement-breakpoint

UPDATE "apps" SET "app_config" = jsonb_set(
  "app_config",
  '{add_to_every_request}',
  coalesce(
    (
      SELECT jsonb_agg(rule)
      FROM jsonb_array_elements("app_config"->'add_to_every_request') AS rule
      WHERE NOT (
        coalesce(rule->>'worked_out_by', '') IN ('login', 'oauth')
        AND jsonb_exists(
          "app_config"->'api_protocol_headers',
          coalesce(rule->>'put_it_in_header', '')
        )
      )
    ),
    '[]'::jsonb
  ),
  true
)
WHERE jsonb_typeof("app_config"->'add_to_every_request') = 'array'
  AND jsonb_typeof("app_config"->'api_protocol_headers') = 'object'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements("app_config"->'add_to_every_request') AS rule
    WHERE coalesce(rule->>'worked_out_by', '') IN ('login', 'oauth')
      AND jsonb_exists(
        "app_config"->'api_protocol_headers',
        coalesce(rule->>'put_it_in_header', '')
      )
  );
