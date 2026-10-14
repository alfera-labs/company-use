import type { Participants } from '@coworker/core/access/may_use_resource';
import type {
  get_tool_catalog_entry,
  resolve_catalog_tool,
} from '@coworker/core/db/queries/catalog';
import type {
  RuntimeCatalogToolInput,
  RuntimeToolExecutionContext,
  RuntimeToolSourceContext,
} from '@runtime-platform/tools/types';

export type CatalogTool = NonNullable<Awaited<ReturnType<typeof get_tool_catalog_entry>>>;
export type ResolvedCatalogTool = Awaited<ReturnType<typeof resolve_catalog_tool>>;
export type ToolConnection = NonNullable<ResolvedCatalogTool['connection']>;

export type ExecuteCatalogToolInput = {
  workspace_id: string;
  session_id: string;
  run_id: string;
  agent_id?: string;
  actor_id: string;
  acting_actor_id?: string;
  participants?: Participants;
  room_private_to?: string | null | undefined;
  node_key: string;
  tool_input: RuntimeCatalogToolInput;
  environment?: RuntimeToolExecutionContext['environment'];
  source_context?: RuntimeToolSourceContext;
  connection_id?: string;
  dynamic_props_id?: string;
  stash_id?: string;
  signal?: AbortSignal;
};
