import { catalog_tool_definitions } from '@/components/app/internal_tool_catalog';
import { connection_tool_definitions } from '@/components/app/internal_tool_connections';
import { research_tool_definitions } from '@/components/app/internal_tool_research';
import { runtime_tool_definitions } from '@/components/app/internal_tool_runtime';
import { schedule_tool_definitions } from '@/components/app/internal_tool_schedules';
import type { InternalToolDefinition } from '@/components/app/internal_tool_view';

export const runtime_internal_tool_definitions = {
  ...research_tool_definitions,
  ...catalog_tool_definitions,
  ...connection_tool_definitions,
  ...schedule_tool_definitions,
  ...runtime_tool_definitions,
} satisfies Record<string, InternalToolDefinition>;
