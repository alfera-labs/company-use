-- Which project a channel route works in.
--
-- A conversation that arrives through a channel (a Slack channel today; a group chat or an
-- inbound address later) starts its chats in this project, so the agent reads that project's
-- instructions and may use only what that project was given. The Slack #sales channel works in
-- Sales: it gets Sales' tools and never a person's own inbox.
--
-- NULL is legal and means "no project": every channel route today, which keeps behaving exactly
-- as before. Nothing is backfilled.
--
-- A column rather than a key in channel_target: the project page asks "which channels work in
-- this project?", which filters on it.
--
-- Idempotent: every statement is safe to re-run.
ALTER TABLE "channels" ADD COLUMN IF NOT EXISTS "project_id" text;--> statement-breakpoint

-- "The channels of this project." Partial because nearly every route has no project.
CREATE INDEX IF NOT EXISTS "idx_channels_project"
  ON "channels" USING btree ("workspace_id","project_id")
  WHERE "project_id" IS NOT NULL;
