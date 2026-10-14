-- What a volume is, as a record on the volume row.
--
-- `volumes` was the one table with nowhere to say anything about itself: no config, no metadata.
-- So where its bytes live was derived, in two files, from the workspace id, and the two agreed
-- only because a comment said they should. That made a second volume for a workspace impossible
-- — a new disk mounted the same folder, opening onto the old files instead of an empty tree —
-- and the moment storage stopped being keyed by workspace, the backup would have listed an empty
-- folder, copied nothing, and still written a manifest saying it had finished.
--
-- `volume_config` holds the answer instead of a rule for computing it:
--
--   {
--     "storage_path": "coworker/volumes/vol_01k.../",   the full path, never derived
--     "storage_layout": "volume_keyed"                    which record in volume_storage_layouts.json
--   }
--
-- Every volume that exists today mounts `coworker/workspaces/<workspace_id>/`, fixed inside its
-- Archil disk when the disk was created, so the backfill states exactly what those disks already
-- mount. Nothing is moved and nothing is re-mounted.

ALTER TABLE volumes ADD COLUMN IF NOT EXISTS volume_config jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE volumes
SET volume_config = jsonb_build_object(
      'storage_path', 'coworker/workspaces/' || workspace_id || '/',
      'storage_layout', 'workspace_keyed'
    ),
    last_updated_time = now()
WHERE volume_config->>'storage_path' IS NULL;

COMMENT ON COLUMN volumes.volume_config IS
  'What this volume is. storage_path is the full bucket path holding its files, always explicit and never derived; storage_layout names the record it came from in volume_storage_layouts.json.';
