-- Memory schema step s0008: mirrors core migration 0093_brain_source_default_scope_route. Sources
-- created before scope routes existed have metadata without a scope_route. A new source gets the
-- fixed workspace route, so every stored source without a route gets that same route. Only rows
-- without the key change, so a rerun changes nothing.
UPDATE "brain_sources"
SET "metadata" = "metadata" || '{"scope_route":{"route":"fixed","scope_key":"workspace"}}'::jsonb
WHERE NOT ("metadata" ? 'scope_route');
