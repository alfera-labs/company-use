-- Memory schema step s0001 (data model v5): scope_key on brain_items, relation/valid_from/valid_until
-- on brain_item_links, and the wider CHECK constraints. Every statement is idempotent: a column add
-- is guarded by IF NOT EXISTS, a constraint add or widen is guarded by a DO block, so replaying this
-- step changes nothing once it has run. The scope_key pattern CHECK matches scope_key_schema in
-- packages/memory/src/contracts/keys.ts exactly: each segment after the kind is 1-128 chars. Every
-- new or widened CHECK here lands NOT VALID: this step commits them without scanning the table, so
-- the ACCESS EXCLUSIVE lock it holds (for the ADD COLUMN and ADD CONSTRAINT statements) stays short.
-- s0004 validates all three in its own later transaction, under the lighter SHARE UPDATE EXCLUSIVE
-- lock a validation scan takes.
ALTER TABLE "brain_items" ADD COLUMN IF NOT EXISTS "scope_key" text NOT NULL DEFAULT 'workspace';--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brain_items_scope_key_check') THEN
    ALTER TABLE "brain_items" ADD CONSTRAINT "brain_items_scope_key_check"
      CHECK (length("scope_key") <= 420 AND "scope_key" ~ '^[a-z][a-z_]{1,30}(:[A-Za-z0-9._-]+){0,3}$' AND "scope_key" !~ '[^:]{129}') NOT VALID;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "brain_item_links" ADD COLUMN IF NOT EXISTS "relation" text;--> statement-breakpoint
ALTER TABLE "brain_item_links" ADD COLUMN IF NOT EXISTS "valid_from" timestamptz;--> statement-breakpoint
ALTER TABLE "brain_item_links" ADD COLUMN IF NOT EXISTS "valid_until" timestamptz;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brain_item_links_relation_check') THEN
    ALTER TABLE "brain_item_links" ADD CONSTRAINT "brain_item_links_relation_check"
      CHECK ("relation" IS NULL OR "relation" ~ '^[a-z][a-z0-9_]{1,40}$');
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'brain_item_links_method_check' AND pg_get_constraintdef(oid) LIKE '%claim_receipt%'
  ) THEN
    ALTER TABLE "brain_item_links" DROP CONSTRAINT IF EXISTS "brain_item_links_method_check";
    ALTER TABLE "brain_item_links" ADD CONSTRAINT "brain_item_links_method_check" CHECK ("link_method" IN
      ('provider_native','url_rule','exact_ref','wikilink','runtime_provenance','authored','model_proposed','human','claim_receipt')) NOT VALID;
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'brain_item_revisions_authored_by_check' AND pg_get_constraintdef(oid) LIKE '%consolidation%'
  ) THEN
    ALTER TABLE "brain_item_revisions" DROP CONSTRAINT IF EXISTS "brain_item_revisions_authored_by_check";
    ALTER TABLE "brain_item_revisions" ADD CONSTRAINT "brain_item_revisions_authored_by_check" CHECK ("authored_by" IN
      ('connector','agent','human','consolidation')) NOT VALID;
  END IF;
END $$;
