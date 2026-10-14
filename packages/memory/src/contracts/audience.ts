import type { ActorKey, ScopeKey, WorkspaceId } from '@coworker/memory/contracts/keys';

export type MemoryAudience = {
  audience_kind: 'principals' | 'whole_workspace';
  home_scope_key: ScopeKey | null;
};

export type OpenViewInput = {
  workspace_id: WorkspaceId;
  audience: MemoryAudience;
  actor: ActorKey;
  surface: 'runtime' | 'mcp' | 'rest' | 'dashboard' | 'job' | 'standalone';
  run_ref: { session_id: string; run_id: string } | null;
};

export type ChannelMemoryAudienceSetting = { guests_count_in_audience: boolean };
