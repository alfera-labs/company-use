import { createHash } from 'node:crypto';
import type { ScheduledTaskAuthorityData } from '@coworker/core/db/schema/json_column_types';

const authority_key = 'delegated_authority';
type ScheduledTaskSource = Record<string, unknown> & {
  delegated_authority?: ScheduledTaskAuthorityData;
};

export function set_scheduled_task_authority(
  source: ScheduledTaskSource | null | undefined,
  actor_id: string,
  instruction: string,
) {
  const current = source ?? {};
  const { [authority_key]: _previous_authority, ...source_without_authority } = current;
  if (actor_id.startsWith('system:')) return source_without_authority;
  return {
    ...source_without_authority,
    [authority_key]: {
      version: 1,
      kind: 'scheduled_task',
      granted_by_actor_id: actor_id,
      granted_time: new Date().toISOString(),
      instruction_sha256: hash_instruction(instruction),
    },
  };
}

export function build_scheduled_task_run_authority(
  trigger_id: string,
  source: ScheduledTaskSource | null | undefined,
  instruction: string,
) {
  const authority = source?.delegated_authority;
  if (
    trigger_id.length === 0 ||
    !is_complete_scheduled_task_authority(authority) ||
    authority.instruction_sha256 !== hash_instruction(instruction)
  ) {
    return null;
  }
  return { [authority_key]: { ...authority, trigger_id } };
}

export function has_scheduled_task_run_authority(
  source_metadata: ScheduledTaskSource | null | undefined,
) {
  return is_complete_scheduled_task_run_authority(source_metadata?.delegated_authority);
}

function is_complete_scheduled_task_authority(
  authority: ScheduledTaskAuthorityData | undefined,
): authority is ScheduledTaskAuthorityData {
  return (
    authority?.version === 1 &&
    authority.kind === 'scheduled_task' &&
    typeof authority.granted_by_actor_id === 'string' &&
    authority.granted_by_actor_id.length > 0 &&
    typeof authority.granted_time === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(authority.granted_time) &&
    !Number.isNaN(Date.parse(authority.granted_time)) &&
    typeof authority.instruction_sha256 === 'string' &&
    /^[a-f0-9]{64}$/u.test(authority.instruction_sha256)
  );
}

function is_complete_scheduled_task_run_authority(
  authority: ScheduledTaskAuthorityData | undefined,
): authority is ScheduledTaskAuthorityData & { trigger_id: string } {
  return (
    is_complete_scheduled_task_authority(authority) &&
    typeof authority.trigger_id === 'string' &&
    authority.trigger_id.length > 0
  );
}

function hash_instruction(instruction: string) {
  return createHash('sha256').update(instruction, 'utf8').digest('hex');
}
