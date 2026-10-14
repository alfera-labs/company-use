import type { Database } from '@coworker/core';
import { stored_context_snapshot_file_purpose } from '@coworker/core/db/queries/files';
import { create_run_model_context_snapshot } from '@coworker/core/db/queries/sessions';
import { create_logger, order_keys_like_jsonb } from '@coworker/shared';
import {
  type ArtifactRef,
  is_large_value,
  load_stored_values,
  read_artifact_ref,
  store_large_value,
} from '@runtime-platform/files/stored_body';

export const context_snapshot_ref_shape = 'context_snapshot_ref_v1';

type RunModelContextSnapshotInput = Parameters<typeof create_run_model_context_snapshot>[1];

const log = create_logger('stored_context_snapshot');

export async function store_run_model_context_snapshot(
  db: Database,
  input: RunModelContextSnapshotInput,
) {
  const snapshot = await snapshot_for_row(db, input);
  return create_run_model_context_snapshot(db, { ...input, snapshot });
}

export async function prepare_context_snapshot_value(
  db: Database,
  input: RunModelContextSnapshotInput,
) {
  return snapshot_for_row(db, input);
}

async function snapshot_for_row(db: Database, input: RunModelContextSnapshotInput) {
  if (!is_large_value(input.snapshot)) return input.snapshot;
  const artifact_ref = await store_snapshot_body(db, input);
  return artifact_ref ? { shape: context_snapshot_ref_shape, artifact_ref } : input.snapshot;
}

async function store_snapshot_body(db: Database, input: RunModelContextSnapshotInput) {
  try {
    return await store_large_value(db, {
      workspace_id: input.workspace_id,
      session_id: input.session_id,
      run_id: input.run_id,
      source_tool_call_id: null,
      file_purpose: stored_context_snapshot_file_purpose,
      value: input.snapshot,
      actor_id: input.actor_id,
    });
  } catch (error) {
    log.error('Storing a context snapshot body failed; it stays inline.', {
      workspace_id: input.workspace_id,
      run_id: input.run_id,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function read_snapshot_ref(snapshot: unknown): ArtifactRef | undefined {
  const shape = (snapshot as { shape?: unknown } | null)?.shape;
  return shape === context_snapshot_ref_shape ? read_artifact_ref(snapshot) : undefined;
}

export async function read_context_snapshots<T extends { snapshot: unknown }>(
  db: Database,
  input: { workspace_id: string; rows: T[] },
): Promise<T[]> {
  const ref_by_row = new Map(
    input.rows.flatMap((row) => {
      const artifact_ref = read_snapshot_ref(row.snapshot);
      return artifact_ref ? [[row, artifact_ref] as const] : [];
    }),
  );
  if (ref_by_row.size === 0) return input.rows;

  const artifact_ids = [...ref_by_row.values()].map((ref) => ref.artifact_id);
  const bodies = await load_bodies_or_report(db, input.workspace_id, artifact_ids);
  return input.rows.map((row) => {
    const artifact_id = ref_by_row.get(row)?.artifact_id;
    if (artifact_id === undefined || !bodies.has(artifact_id)) return row;
    return { ...row, snapshot: order_keys_like_jsonb(bodies.get(artifact_id)) };
  });
}

async function load_bodies_or_report(db: Database, workspace_id: string, artifact_ids: string[]) {
  try {
    const bodies = await load_stored_values(db, { workspace_id, artifact_ids });
    const missing = artifact_ids.filter((artifact_id) => !bodies.has(artifact_id));
    if (missing.length > 0) {
      log.error('Stored context snapshots are missing; their pointers stand in.', {
        workspace_id,
        artifact_ids: missing,
      });
    }
    return bodies;
  } catch (error) {
    log.error('Reading stored context snapshots failed; their pointers stand in.', {
      workspace_id,
      artifact_ids,
      error: error instanceof Error ? error.message : String(error),
    });
    return new Map<string, unknown>();
  }
}
