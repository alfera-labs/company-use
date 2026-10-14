import type { Database } from '@coworker/core';
import type { ApiKey } from '@coworker/core/db/queries/api_keys';

type ApiVariables = {
  db: Database;
  workspace_id: string;
  user_id: string;
  agent_id: string;
  api_key?: ApiKey;
  api_key_rate_remaining?: number;
  readable_session_id?: string;
};

export type ApiEnv = {
  Variables: ApiVariables;
};

export type ApiKeyEnv = {
  Variables: ApiVariables & { api_key: ApiKey };
};
