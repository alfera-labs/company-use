import { get_trigger_wire_provisioner } from '@api/services/triggers/trigger_wire';
import type { DatabaseExecutor } from '@coworker/core';
import { count_enabled_triggers_sharing_provisioning_key } from '@coworker/core/db/queries/trigger_provisioning';
import { create_logger } from '@coworker/shared';

const log = create_logger('schedule_new_trigger');

// Is another enabled trigger still listening on this same provider instance? Composio upserts one
// instance per (account, event), so sibling automations share a wire and the last one out turns it
// off. A row with no provisioning key of its own shares nothing.
export async function wire_is_still_wanted(
  db: DatabaseExecutor,
  trigger_id: string,
  wire: { provisioned_by: string; provisioning_key: string },
) {
  const others = await count_enabled_triggers_sharing_provisioning_key(db, {
    ...wire,
    except_trigger_id: trigger_id,
  });
  if (others > 0) {
    log.info('kept a shared trigger wire alive for its other listeners', {
      provisioning_key: wire.provisioning_key,
      trigger_id,
      still_listening: others,
    });
  }
  return others > 0;
}

const wire_is_gone_detail = 'The provider no longer has this wire.';

export function wire_is_already_gone(error: unknown) {
  const status = (error as { status?: number } | null)?.status;
  return status === 404 || status === 410;
}

export async function set_wire_enabled(
  wire: { provisioned_by: string; provisioning_key: string },
  enabled: boolean,
): Promise<string | null> {
  try {
    await get_trigger_wire_provisioner(wire.provisioned_by).set_enabled({
      provisioning_key: wire.provisioning_key,
      enabled,
    });
    return null;
  } catch (error) {
    if (!wire_is_already_gone(error)) throw error;
    log.warn('trigger wire was already gone', { provisioning_key: wire.provisioning_key });
    return wire_is_gone_detail;
  }
}
