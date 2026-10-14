import { env } from '@coworker/config';
import { type Database, workspace_model_access } from '@coworker/core';
import { find_session_with_agent } from '@coworker/core/db/queries/session_agent';
import { NotFoundError } from '@coworker/shared';
import { resolve_model } from '@runtime-platform/model_resolver';
import { build_workspace_model_environment } from '@runtime-platform/workspace_model_environment';

export function begin_run_start_credit_gates(
  _db: Database,
  _input: { workspace_id: string; actor_id: string; continues_started_run?: boolean },
) {
  return async (_runs_on_workspace_credential: boolean) => {};
}

export async function check_run_start_credit_gates(
  db: Database,
  input: {
    workspace_id: string;
    session_id: string;
    actor_id: string;
    model_provider?: string | undefined;
    model_proxy?: string | undefined;
    model_name?: string | undefined;
  },
) {
  const [agent, workspace_model_environment, model_access] = await Promise.all([
    find_session_with_agent(db, input).then((session) => {
      if (!session) throw new NotFoundError('Session');
      return session.agent;
    }),
    build_workspace_model_environment(db, input.workspace_id),
    workspace_model_access(db, input.workspace_id),
  ]);
  resolve_model(
    {
      workspace_id: input.workspace_id,
      model_provider: input.model_provider ?? null,
      model_proxy: input.model_proxy ?? null,
      model_name: input.model_name ?? null,
      default_model: agent?.default_model ?? null,
      default_model_provider: agent?.default_model_provider ?? null,
      default_model_name: agent?.default_model_name ?? null,
      agent_config: agent?.agent_config ?? null,
      model_access: { model_access, gateway_models_enabled: env.MODEL_GATEWAY_UNLOCKED },
      nobody_is_waiting: false,
    },
    workspace_model_environment,
  );
}
