import type { SessionMetadata } from '@coworker/core/db/schema/json_column_types';

type ChannelSource = 'slack' | 'email';
export type SessionSource = 'dashboard' | ChannelSource | 'api' | 'trigger' | 'system';
export type RunMessageSource = 'dashboard' | ChannelSource | 'api' | 'runtime' | 'tool';

export type CreateSessionInput = {
  workspace_id: string;
  agent_id: string;
  project_id?: string;
  session_title?: string;
  source_type?: SessionSource;
  session_source?: SessionSource;
  external_thread_key?: string | null;
  source_metadata?: Record<string, unknown>;
  session_metadata?: SessionMetadata;
  actor_id: string;
};
