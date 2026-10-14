-- Enforce the idempotency contract migration 0005 declared and nothing used.
--
-- tool_calls.idempotency_key has existed since 0005 ("an explicit idempotency_key column
-- so the contract is visible") with zero writers: no row carries a value, so
-- a retried or interleaved run could issue the same external mutation twice.
--
-- The runtime now stamps `{run_id}:{model_tool_call_id}` at tool-call start. This partial
-- unique index makes a duplicate stamp an insert conflict the executor can catch, instead
-- of a second live send. Partial: legacy NULL rows and calls without a model tool-call id
-- stay unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_tool_calls_idempotency_key_unique"
  ON "tool_calls" ("workspace_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
