-- Memory schema step s0004 (data model v5): validates the scope_key, link_method, and authored_by
-- CHECKs s0001 added or widened NOT VALID, each in its own transaction so its scan runs under
-- SHARE UPDATE EXCLUSIVE instead of the ACCESS EXCLUSIVE lock s0001's ADD COLUMN/ADD CONSTRAINT
-- statements hold. VALIDATE CONSTRAINT on an already-valid constraint is a fast no-op, so replaying
-- this step changes nothing.
ALTER TABLE "brain_items" VALIDATE CONSTRAINT "brain_items_scope_key_check";--> statement-breakpoint
ALTER TABLE "brain_item_links" VALIDATE CONSTRAINT "brain_item_links_method_check";--> statement-breakpoint
ALTER TABLE "brain_item_revisions" VALIDATE CONSTRAINT "brain_item_revisions_authored_by_check";
