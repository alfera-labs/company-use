-- Make the one-time Starter welcome credit idempotent by giving it a deterministic
-- primary key per workspace. First collapse any duplicate welcome grants that the
-- earlier non-atomic count-then-insert could have produced (keep the earliest), then
-- rewrite the survivor's id to the deterministic form so future inserts are no-ops.
-- Idempotent: a re-run finds no duplicates and no non-deterministic ids to rewrite.
DELETE FROM "billing_credit_ledger" a
USING "billing_credit_ledger" b
WHERE a."entry_type" = 'plan_grant' AND a."source" = 'system' AND a."description" = 'Starter welcome credit'
  AND b."entry_type" = 'plan_grant' AND b."source" = 'system' AND b."description" = 'Starter welcome credit'
  AND a."workspace_id" = b."workspace_id"
  AND (a."created_time" > b."created_time"
       OR (a."created_time" = b."created_time" AND a."billing_credit_ledger_id" > b."billing_credit_ledger_id"));--> statement-breakpoint
UPDATE "billing_credit_ledger"
SET "billing_credit_ledger_id" = 'credit_welcome_' || "workspace_id"
WHERE "entry_type" = 'plan_grant' AND "source" = 'system' AND "description" = 'Starter welcome credit'
  AND "billing_credit_ledger_id" <> 'credit_welcome_' || "workspace_id";
