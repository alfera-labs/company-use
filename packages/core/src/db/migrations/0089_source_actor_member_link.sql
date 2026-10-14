-- Member account link tool. The link state lives on source_actors, the table that owns
-- the member identity being linked, as an explicit column with a CHECK constraint (never JSON
-- metadata). idx_source_actors_member_link_state speeds up a sync job sweeping pending links.
--> statement-breakpoint
ALTER TABLE "source_actors" ADD COLUMN IF NOT EXISTS "member_link_state" text NOT NULL DEFAULT 'unlinked';
--> statement-breakpoint
ALTER TABLE "source_actors" ADD COLUMN IF NOT EXISTS "linked_user_id" text;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'source_actors_member_link_state_check'
	) THEN
		ALTER TABLE "source_actors" ADD CONSTRAINT "source_actors_member_link_state_check"
			CHECK ("member_link_state" IN ('unlinked', 'pending_confirmation', 'linked'));
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_source_actors_member_link_state"
	ON "source_actors" ("workspace_id", "member_link_state")
	WHERE "member_link_state" = 'pending_confirmation';
