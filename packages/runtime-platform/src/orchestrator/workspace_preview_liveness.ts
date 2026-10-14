import type { Database } from '@coworker/core';
import {
  get_runtime_environment,
  update_runtime_environment_state,
} from '@coworker/core/db/queries/sessions';
import { is_e2b_preview_ready } from '@runtime-platform/orchestrator/e2b_sandbox_client';
import {
  find_active_preview,
  list_active_preview_ports,
  without_active_preview_ports,
} from '@runtime-platform/orchestrator/preview_metadata';
import type { RuntimeEnvironment } from '@runtime-platform/orchestrator/workspace_close';
import { read_volume_id } from '@runtime-platform/storage/volume_metadata';

export async function runtime_environment_has_active_preview(
  db: Database,
  input: { workspace_id: string; runtime_environment_id: string; actor_id: string },
) {
  const environment = await get_runtime_environment(db, {
    workspace_id: input.workspace_id,
    runtime_environment_id: input.runtime_environment_id,
  });
  if (!environment) return false;
  const metadata = environment.environment_metadata;
  if (read_volume_id(metadata) && metadata.browser_started !== true) return false;
  const ports = list_active_preview_ports(metadata);
  if (ports.length === 0) return false;

  if (environment.environment_provider !== 'e2b') return true;
  if (!environment.provider_environment_id) {
    await update_runtime_environment_state(db, {
      runtime_environment_id: input.runtime_environment_id,
      environment_status: environment.environment_status,
      environment_metadata: without_active_preview_ports(metadata, ports, {
        last_preview_liveness_check_time: new Date().toISOString(),
        last_preview_error_message: 'E2B preview metadata had no provider sandbox id.',
      }),
      actor_id: input.actor_id,
    });
    return false;
  }

  const live_ports = await find_live_preview_ports(
    environment,
    environment.provider_environment_id,
    ports,
  );
  const stale_ports = ports.filter((port) => !live_ports.includes(port));
  if (stale_ports.length > 0) {
    await update_runtime_environment_state(db, {
      runtime_environment_id: input.runtime_environment_id,
      environment_status: environment.environment_status,
      environment_metadata: without_active_preview_ports(metadata, stale_ports, {
        last_preview_liveness_check_time: new Date().toISOString(),
        last_stale_preview_ports: stale_ports,
      }),
      actor_id: input.actor_id,
    });
  }

  return live_ports.length > 0;
}

async function find_live_preview_ports(
  environment: RuntimeEnvironment,
  provider_environment_id: string,
  ports: number[],
) {
  const readiness = await Promise.all(
    ports.map((port) => {
      const preview = find_active_preview(environment.environment_metadata, port);
      return is_e2b_preview_ready({
        provider_sandbox_id: provider_environment_id,
        port,
        ...(typeof preview?.ready_path === 'string' ? { ready_path: preview.ready_path } : {}),
      });
    }),
  );
  return ports.filter((_, index) => readiness[index]);
}
