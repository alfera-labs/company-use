import {
  agent_heartbeat_actor,
  agent_heartbeat_config_key,
  agent_heartbeat_job_handler,
  agent_heartbeat_session_kind,
  agent_heartbeat_session_thread_prefix,
} from '@shared/agent_heartbeat_stored_values';

export const scout_job_handler = agent_heartbeat_job_handler;

export const scout_provisioning_key = 'workspace_heartbeat_v1';

export const scout_session_kind = agent_heartbeat_session_kind;

export const scout_session_thread_prefix = agent_heartbeat_session_thread_prefix;

export const scout_actor = agent_heartbeat_actor;

export const scout_config_key = agent_heartbeat_config_key;

export const scout_provisioning_actor = 'system:heartbeat_provisioning';

export const scout_trigger_purpose = 'workspace_heartbeat';
