-- Replies come home by RFC 5322 header chain, so a conversation that SENDS mail records the
-- Message-IDs it sent under source_metadata.email.sent_message_ids. An inbound reply's
-- In-Reply-To/References is looked up against that list, which is what lets an answer resume
-- the conversation that asked — including a dashboard chat. Containment-indexed so the lookup
-- is a probe, not a scan over the workspace's sessions.
CREATE INDEX IF NOT EXISTS "idx_sessions_sent_message_ids" ON "sessions"
  USING gin (((source_metadata -> 'email' -> 'sent_message_ids')) jsonb_path_ops);
