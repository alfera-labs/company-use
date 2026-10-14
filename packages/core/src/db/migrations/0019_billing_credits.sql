ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "payment_method_brand" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "payment_method_last4" text;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_credit_ledger" (
	"billing_credit_ledger_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"entry_type" text NOT NULL,
	"amount_microcents" bigint NOT NULL,
	"source" text DEFAULT 'system' NOT NULL,
	"stripe_invoice_id" text,
	"stripe_payment_intent_id" text,
	"description" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_time" timestamp with time zone DEFAULT now() NOT NULL,
	"last_updated_time" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"last_updated_by" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_credit_ledger_workspace" ON "billing_credit_ledger" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_credit_ledger_invoice_unique" ON "billing_credit_ledger" USING btree ("stripe_invoice_id") WHERE "billing_credit_ledger"."stripe_invoice_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_credit_ledger_payment_intent_unique" ON "billing_credit_ledger" USING btree ("stripe_payment_intent_id") WHERE "billing_credit_ledger"."stripe_payment_intent_id" IS NOT NULL;
