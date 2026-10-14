import { find_active_workspace_member_role } from '@coworker/core/db/queries/workspace_membership';
import { AppError, is_workspace_administrator_role } from '@coworker/shared';

export function redacted_volume(volume: {
  volume_id: string;
  volume_provider: string;
  volume_status: string;
  provider_region: string | null;
  last_synced_time: Date | null;
  last_error_code: string | null;
  last_error_message: string | null;
}) {
  return {
    volume_id: volume.volume_id,
    volume_provider: volume.volume_provider,
    volume_status: volume.volume_status,
    provider_region: volume.provider_region,
    last_synced_time: volume.last_synced_time,
    last_error_code: volume.last_error_code,
    last_error_message: volume.last_error_message
      ? 'Persistent workspace storage needs administrator attention.'
      : null,
  };
}

export async function assert_volume_manager(
  db: Parameters<typeof find_active_workspace_member_role>[0],
  input: { workspace_id: string; user_id: string },
) {
  const role = await find_active_workspace_member_role(db, input);
  if (is_workspace_administrator_role(role)) return;
  throw new AppError(
    'volume_access_denied',
    'Only workspace owners and admins can provision persistent storage.',
    403,
  );
}
