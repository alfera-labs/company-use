import { env } from '@coworker/config';
import type { Database, events as events_table } from '@coworker/core';
import { find_volume } from '@coworker/core/db/queries/volumes';
import type { EventJobHandlerResult } from '@coworker/jobs';
import { read_volume_storage_path } from '@coworker/shared';
import { open_file_object_storage } from '@runtime-platform/files/object_storage';
import { create_volume_snapshot } from '@runtime-platform/storage/create_volume_snapshot';
import { find_latest_volume_snapshot_manifest } from '@runtime-platform/storage/find_latest_volume_snapshot';
import { generate_generation_id } from '@runtime-platform/storage/volume_snapshot_keys';

type VolumeSnapshotJobInput = {
  db: Database;
  workspace_id: string;
  events: (typeof events_table.$inferSelect)[];
  heartbeat: () => Promise<void>;
};

export async function run_volume_snapshot_job(
  input: VolumeSnapshotJobInput,
): Promise<EventJobHandlerResult> {
  if (!env.VOLUME_SNAPSHOTS_ENABLED) {
    return skipped_result('VOLUME_SNAPSHOTS_ENABLED is off');
  }
  const volume = await find_volume(input.db, input.workspace_id);
  if (!volume || volume.volume_status !== 'active') {
    return skipped_result('Workspace has no active volume');
  }

  const backup_storage = open_file_object_storage('volume_backup_store');
  const result = await create_volume_snapshot({
    workspace_id: input.workspace_id,
    storage_path: read_volume_storage_path(volume),
    ...name_this_backup_after_its_event(input.events),
    source_bucket: require_volume_bucket(),
    volume_storage: open_file_object_storage('volume_object_store'),
    backup_storage,
    previous_manifest: await find_latest_volume_snapshot_manifest(
      backup_storage,
      input.workspace_id,
    ),
  });
  await input.heartbeat();
  return { job_status: 'done', result_data: { ...result } };
}

function name_this_backup_after_its_event(events: (typeof events_table.$inferSelect)[]) {
  const requesting_event = events.at(-1);
  if (!requesting_event) {
    throw new Error('A volume backup job needs an event to take its name from');
  }
  return {
    created_time: requesting_event.created_time,
    generation_id: generate_generation_id(requesting_event.created_time),
  };
}

function skipped_result(skipped_because: string): EventJobHandlerResult {
  return { job_status: 'done', result_data: { skipped_because } };
}

function require_volume_bucket() {
  if (!env.R2_BUCKET_NAME) {
    throw new Error('R2_BUCKET_NAME is required to back up a workspace');
  }
  return env.R2_BUCKET_NAME;
}
