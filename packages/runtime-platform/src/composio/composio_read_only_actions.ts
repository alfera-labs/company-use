import type { CatalogTool } from '@runtime-platform/tools/catalog_tool_types';
import { z } from 'zod';

const composio_annotations_schema = z.object({
  annotations: z.object({ tags: z.array(z.string()) }),
});

/** True only when Composio tagged the action readOnlyHint; an untagged action counts as a write. */
export function is_read_only_composio_action(tool: CatalogTool) {
  const parsed = composio_annotations_schema.safeParse(tool.metadata);
  return parsed.success && parsed.data.annotations.tags.includes('readOnlyHint');
}
